/* bbgpu_glsl.c - TGSI -> GLSL ES 3.00 for the Bootbox GPU bridge (float-only shaders, GLSL 1.20 class).
 * Naming follows bbgpu_proto.h: bb_a<n> vertex inputs, bb_vc/bb_fc uniform vec4 arrays, bb_s<n> samplers,
 * bb_o<n> fragment outputs, bb_flip for Gallium's y-down window framebuffers. Varyings are named after their
 * TGSI semantic so the two stages of a program link by name; a stage is always generated together with its
 * partner because GLSL ES requires matching declarations and interpolation qualifiers.
 * SPDX-License-Identifier: MIT */
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "tgsi/tgsi_info.h"
#include "tgsi/tgsi_parse.h"
#include "tgsi/tgsi_scan.h"
#include "tgsi/tgsi_strings.h"
#include "util/u_math.h"
#include "bbgpu_context.h"

struct sb { char *s; size_t n, cap; bool fail; };
static void sb_printf(struct sb *b, const char *fmt, ...)
{
   va_list ap;
   for (;;) {
      va_start(ap, fmt);
      int k = vsnprintf(b->s ? b->s + b->n : NULL, b->s ? b->cap - b->n : 0, fmt, ap);
      va_end(ap);
      if (k < 0) { b->fail = true; return; }
      if (b->s && b->n + k < b->cap) { b->n += k; return; }
      b->cap = MAX2(b->cap * 2, b->n + k + 1024);
      b->s = realloc(b->s, b->cap);
   }
}

#define MAXREG 64
struct tr {
   const struct bbgpu_shader *sh, *other;
   bool vs;
   struct sb decl, body;
   char in_name[MAXREG][48], out_name[MAXREG][48];
   unsigned out_sem[MAXREG];
   unsigned ntemps, nimm, sampler_target[16];
   float imm[256][4];
   int indent;
   bool uses_addr;
   const char *err;
};

static const char *sem_name(unsigned sem) { return sem < TGSI_SEMANTIC_COUNT ? tgsi_semantic_names[sem] : "X"; }
static void varying_name(char *out, unsigned sem, unsigned idx) { snprintf(out, 48, "bb_v_%s%u", sem_name(sem), idx); }

/* interpolation of the fragment input with this semantic (from whichever stage is the FS) */
static bool fs_input_flat(const struct tgsi_shader_info *fs, unsigned sem, unsigned idx)
{
   for (unsigned i = 0; i < fs->num_inputs; i++)
      if (fs->input_semantic_name[i] == sem && fs->input_semantic_index[i] == idx)
         return fs->input_interpolate[i] == TGSI_INTERPOLATE_CONSTANT;
   return false;
}
static bool is_varying(unsigned sem)
{
   return sem != TGSI_SEMANTIC_POSITION && sem != TGSI_SEMANTIC_PSIZE && sem != TGSI_SEMANTIC_FACE &&
          sem != TGSI_SEMANTIC_CLIPDIST && sem != TGSI_SEMANTIC_CLIPVERTEX && sem != TGSI_SEMANTIC_EDGEFLAG;
}

static void ind(struct tr *t) { for (int i = 0; i < t->indent; i++) sb_printf(&t->body, "  "); }

static void src(struct tr *t, const struct tgsi_full_src_register *s, char *out, size_t n)
{
   char base[128];
   const struct tgsi_src_register *r = &s->Register;
   char addr[32] = "";
   if (r->Indirect) {
      t->uses_addr = true;
      snprintf(addr, sizeof addr, " + bb_addr.%c", "xyzw"[s->Indirect.Swizzle]);
   }
   switch (r->File) {
   case TGSI_FILE_TEMPORARY: snprintf(base, sizeof base, "t[%d%s]", r->Index, addr); break;
   case TGSI_FILE_CONSTANT: snprintf(base, sizeof base, "%s[%d%s]", t->vs ? "bb_vc" : "bb_fc", r->Index, addr); break;
   case TGSI_FILE_IMMEDIATE: snprintf(base, sizeof base, "imm[%d]", r->Index); break;
   case TGSI_FILE_INPUT:
      snprintf(base, sizeof base, "%s", r->Index < MAXREG && t->in_name[r->Index][0] ? t->in_name[r->Index] : "vec4(0.0)");
      break;
   case TGSI_FILE_OUTPUT:
      snprintf(base, sizeof base, "%s", r->Index < MAXREG && t->out_name[r->Index][0] ? t->out_name[r->Index] : "vec4(0.0)");
      break;
   case TGSI_FILE_ADDRESS: snprintf(base, sizeof base, "vec4(bb_addr)"); break;
   case TGSI_FILE_SAMPLER: case TGSI_FILE_SAMPLER_VIEW:   /* texture operands: used by tex_expr() by index */
      snprintf(out, n, "bb_s%d", r->Index); return;
   default:
      t->err = "unsupported source register file";
      snprintf(base, sizeof base, "vec4(0.0)");
   }
   char sw[8] = "";
   if (r->SwizzleX != 0 || r->SwizzleY != 1 || r->SwizzleZ != 2 || r->SwizzleW != 3)
      snprintf(sw, sizeof sw, ".%c%c%c%c", "xyzw"[r->SwizzleX], "xyzw"[r->SwizzleY], "xyzw"[r->SwizzleZ], "xyzw"[r->SwizzleW]);
   char e[200];
   snprintf(e, sizeof e, "%s%s", base, sw);
   if (r->Absolute) { char a[220]; snprintf(a, sizeof a, "abs(%s)", e); strcpy(e, a); }
   if (r->Negate) snprintf(out, n, "(-%s)", e); else snprintf(out, n, "%s", e);
}

static const char *mask_str(unsigned m, char *buf)
{
   int k = 0;
   buf[k++] = '.';
   for (int i = 0; i < 4; i++) if (m & (1 << i)) buf[k++] = "xyzw"[i];
   buf[k] = 0;
   return buf;
}

static void dst_assign(struct tr *t, const struct tgsi_full_dst_register *d, bool sat, const char *expr)
{
   const struct tgsi_dst_register *r = &d->Register;
   char m[6]; mask_str(r->WriteMask, m);
   char e[2048];
   if (sat) snprintf(e, sizeof e, "clamp(%s, 0.0, 1.0)", expr); else snprintf(e, sizeof e, "%s", expr);
   ind(t);
   if (r->File == TGSI_FILE_TEMPORARY) {
      if (r->Indirect) { t->uses_addr = true; sb_printf(&t->body, "t[%d + bb_addr.%c]%s = (%s)%s;\n", r->Index, "xyzw"[d->Indirect.Swizzle], m, e, m); }
      else sb_printf(&t->body, "t[%d]%s = (%s)%s;\n", r->Index, m, e, m);
   } else if (r->File == TGSI_FILE_OUTPUT) {
      unsigned sem = r->Index < MAXREG ? t->out_sem[r->Index] : 0;
      if (t->vs && sem == TGSI_SEMANTIC_PSIZE) sb_printf(&t->body, "gl_PointSize = (%s).x;\n", e);
      else if (!t->vs && sem == TGSI_SEMANTIC_POSITION) sb_printf(&t->body, "gl_FragDepth = (%s).z;\n", e);
      else if (r->Index < MAXREG && t->out_name[r->Index][0]) sb_printf(&t->body, "%s%s = (%s)%s;\n", t->out_name[r->Index], m, e, m);
      else sb_printf(&t->body, "/* dropped output %d */\n", r->Index);
   } else if (r->File == TGSI_FILE_ADDRESS) {
      sb_printf(&t->body, "bb_addr%s = ivec4(%s)%s;\n", m, e, m);
      t->uses_addr = true;
   } else {
      t->err = "unsupported destination register file";
   }
}

static void tex_expr(struct tr *t, const struct tgsi_full_instruction *in, const char s[][256], char *out, size_t n)
{
   unsigned op = in->Instruction.Opcode;
   unsigned samp_src = op == TGSI_OPCODE_TXD ? 3 : op == TGSI_OPCODE_TXQ ? 1 : 1;
   unsigned unit = in->Src[samp_src].Register.Index;
   unsigned target = in->Texture.Texture;
   if (unit < 16) t->sampler_target[unit] = target;
   char coord[300];
   bool shadow = target == TGSI_TEXTURE_SHADOW2D || target == TGSI_TEXTURE_SHADOWRECT || target == TGSI_TEXTURE_SHADOW1D;
   if (shadow) {
      /* sampler2DShadow: the reference is .z (TXP: divided by .w like the coordinates) */
      const char *xy = target == TGSI_TEXTURE_SHADOW1D ? "vec2((%s).x, 0.5)" : "(%s).xy";
      char c[200]; snprintf(c, sizeof c, xy, s[0]);
      if (target == TGSI_TEXTURE_SHADOWRECT) { char r[300]; snprintf(r, sizeof r, "(%s / vec2(textureSize(bb_s%u, 0)))", c, unit); strcpy(c, r); }
      switch (op) {
      case TGSI_OPCODE_TXP: snprintf(out, n, "vec4(texture(bb_s%u, vec3(%s / (%s).w, (%s).z / (%s).w)))", unit, c, s[0], s[0], s[0]); break;
      case TGSI_OPCODE_TXB: snprintf(out, n, "vec4(texture(bb_s%u, vec3(%s, (%s).z), (%s).w))", unit, c, s[0], s[0]); break;
      case TGSI_OPCODE_TXL: snprintf(out, n, "vec4(textureLod(bb_s%u, vec3(%s, (%s).z), (%s).w))", unit, c, s[0], s[0]); break;
      case TGSI_OPCODE_TXQ: snprintf(out, n, "vec4(vec2(textureSize(bb_s%u, int((%s).x))), 0.0, 1.0)", unit, s[0]); break;
      default: snprintf(out, n, "vec4(texture(bb_s%u, vec3(%s, (%s).z)))", unit, c, s[0]); break;
      }
      return;
   }
   if (target == TGSI_TEXTURE_1D) snprintf(coord, sizeof coord, "vec2((%s).x, 0.5)", s[0]);
   else if (target == TGSI_TEXTURE_RECT) snprintf(coord, sizeof coord, "((%s).xy / vec2(textureSize(bb_s%u, 0)))", s[0], unit);
   else if (target == TGSI_TEXTURE_2D) snprintf(coord, sizeof coord, "(%s).xy", s[0]);
   else { t->err = "unsupported texture target (only 1D/2D/RECT)"; snprintf(coord, sizeof coord, "(%s).xy", s[0]); }
   switch (op) {
   case TGSI_OPCODE_TEX: snprintf(out, n, "texture(bb_s%u, %s)", unit, coord); break;
   case TGSI_OPCODE_TXP: snprintf(out, n, "texture(bb_s%u, %s / (%s).w)", unit, coord, s[0]); break;
   case TGSI_OPCODE_TXB: snprintf(out, n, "texture(bb_s%u, %s, (%s).w)", unit, coord, s[0]); break;
   case TGSI_OPCODE_TXL: snprintf(out, n, "textureLod(bb_s%u, %s, (%s).w)", unit, coord, s[0]); break;
   case TGSI_OPCODE_TXD: snprintf(out, n, "textureGrad(bb_s%u, %s, (%s).xy, (%s).xy)", unit, coord, s[1], s[2]); break;
   case TGSI_OPCODE_TXQ: snprintf(out, n, "vec4(vec2(textureSize(bb_s%u, int((%s).x))), 0.0, 1.0)", unit, s[0]); break;
   }
}

static void epilogue(struct tr *t)
{
   if (t->vs) { ind(t); sb_printf(&t->body, "gl_Position = vec4(bb_pos.x, bb_pos.y * bb_flip, bb_pos.z, bb_pos.w);\n"); }
}

static void instruction(struct tr *t, const struct tgsi_full_instruction *in)
{
   unsigned op = in->Instruction.Opcode;
   char s[4][256];
   for (unsigned i = 0; i < in->Instruction.NumSrcRegs && i < 4; i++)
      src(t, &in->Src[i], s[i], sizeof s[i]);
   char e[1024] = "";
   bool sat = in->Instruction.Saturate;
#define X(fmt, ...) snprintf(e, sizeof e, fmt, __VA_ARGS__)
   switch (op) {
   case TGSI_OPCODE_NOP: return;
   case TGSI_OPCODE_MOV: X("%s", s[0]); break;
   case TGSI_OPCODE_ADD: X("%s + %s", s[0], s[1]); break;
   case TGSI_OPCODE_MUL: X("%s * %s", s[0], s[1]); break;
   case TGSI_OPCODE_DIV: X("%s / %s", s[0], s[1]); break;
   case TGSI_OPCODE_MAD: X("%s * %s + %s", s[0], s[1], s[2]); break;
   case TGSI_OPCODE_DP2: X("vec4(dot((%s).xy, (%s).xy))", s[0], s[1]); break;
   case TGSI_OPCODE_DP3: X("vec4(dot((%s).xyz, (%s).xyz))", s[0], s[1]); break;
   case TGSI_OPCODE_DP4: X("vec4(dot(%s, %s))", s[0], s[1]); break;
   case TGSI_OPCODE_DST: X("vec4(1.0, (%s).y * (%s).y, (%s).z, (%s).w)", s[0], s[1], s[0], s[1]); break;
   case TGSI_OPCODE_MIN: X("min(%s, %s)", s[0], s[1]); break;
   case TGSI_OPCODE_MAX: X("max(%s, %s)", s[0], s[1]); break;
   case TGSI_OPCODE_SLT: X("vec4(lessThan(%s, %s))", s[0], s[1]); break;
   case TGSI_OPCODE_SGE: X("vec4(greaterThanEqual(%s, %s))", s[0], s[1]); break;
   case TGSI_OPCODE_SGT: X("vec4(greaterThan(%s, %s))", s[0], s[1]); break;
   case TGSI_OPCODE_SLE: X("vec4(lessThanEqual(%s, %s))", s[0], s[1]); break;
   case TGSI_OPCODE_SEQ: X("vec4(equal(%s, %s))", s[0], s[1]); break;
   case TGSI_OPCODE_SNE: X("vec4(notEqual(%s, %s))", s[0], s[1]); break;
   case TGSI_OPCODE_RCP: X("vec4(1.0 / (%s).x)", s[0]); break;
   case TGSI_OPCODE_RSQ: X("vec4(inversesqrt((%s).x))", s[0]); break;
   case TGSI_OPCODE_SQRT: X("vec4(sqrt((%s).x))", s[0]); break;
   case TGSI_OPCODE_EX2: X("vec4(exp2((%s).x))", s[0]); break;
   case TGSI_OPCODE_LG2: X("vec4(log2((%s).x))", s[0]); break;
   case TGSI_OPCODE_POW: X("vec4(pow((%s).x, (%s).x))", s[0], s[1]); break;
   case TGSI_OPCODE_EXP: X("vec4(exp2(floor((%s).x)), (%s).x - floor((%s).x), exp2((%s).x), 1.0)", s[0], s[0], s[0], s[0]); break;
   case TGSI_OPCODE_LOG: X("vec4(floor(log2(abs((%s).x))), abs((%s).x) / exp2(floor(log2(abs((%s).x)))), log2(abs((%s).x)), 1.0)", s[0], s[0], s[0], s[0]); break;
   case TGSI_OPCODE_FRC: X("fract(%s)", s[0]); break;
   case TGSI_OPCODE_FLR: X("floor(%s)", s[0]); break;
   case TGSI_OPCODE_CEIL: X("ceil(%s)", s[0]); break;
   case TGSI_OPCODE_TRUNC: X("trunc(%s)", s[0]); break;
   case TGSI_OPCODE_ROUND: X("roundEven(%s)", s[0]); break;
   case TGSI_OPCODE_SSG: X("sign(%s)", s[0]); break;
   case TGSI_OPCODE_SIN: X("vec4(sin((%s).x))", s[0]); break;
   case TGSI_OPCODE_COS: X("vec4(cos((%s).x))", s[0]); break;
   case TGSI_OPCODE_LRP: X("mix(%s, %s, %s)", s[2], s[1], s[0]); break;
   case TGSI_OPCODE_CMP: X("mix(%s, %s, vec4(lessThan(%s, vec4(0.0))))", s[2], s[1], s[0]); break;
   case TGSI_OPCODE_DDX: case TGSI_OPCODE_DDX_FINE: X("dFdx(%s)", s[0]); break;
   case TGSI_OPCODE_DDY: case TGSI_OPCODE_DDY_FINE: X("dFdy(%s)", s[0]); break;
   case TGSI_OPCODE_ARL: X("floor(%s)", s[0]); break;
   case TGSI_OPCODE_ARR: X("roundEven(%s)", s[0]); break;
   case TGSI_OPCODE_TEX: case TGSI_OPCODE_TXP: case TGSI_OPCODE_TXB: case TGSI_OPCODE_TXL:
   case TGSI_OPCODE_TXD: case TGSI_OPCODE_TXQ:
      tex_expr(t, in, (const char (*)[256])s, e, sizeof e); break;
   case TGSI_OPCODE_KILL: ind(t); sb_printf(&t->body, "discard;\n"); return;
   case TGSI_OPCODE_KILL_IF: ind(t); sb_printf(&t->body, "if (any(lessThan(%s, vec4(0.0)))) discard;\n", s[0]); return;
   case TGSI_OPCODE_IF: case TGSI_OPCODE_UIF:
      ind(t); sb_printf(&t->body, "if ((%s).x != 0.0) {\n", s[0]); t->indent++; return;
   case TGSI_OPCODE_ELSE: t->indent--; ind(t); sb_printf(&t->body, "} else {\n"); t->indent++; return;
   case TGSI_OPCODE_ENDIF: case TGSI_OPCODE_ENDLOOP: t->indent--; ind(t); sb_printf(&t->body, "}\n"); return;
   case TGSI_OPCODE_BGNLOOP: ind(t); sb_printf(&t->body, "while (true) {\n"); t->indent++; return;
   case TGSI_OPCODE_BRK: ind(t); sb_printf(&t->body, "break;\n"); return;
   case TGSI_OPCODE_CONT: ind(t); sb_printf(&t->body, "continue;\n"); return;
   case TGSI_OPCODE_RET: epilogue(t); ind(t); sb_printf(&t->body, "return;\n"); return;
   case TGSI_OPCODE_END: epilogue(t); return;
   default:
      t->err = tgsi_get_opcode_name(op);
      return;
   }
#undef X
   if (in->Instruction.NumDstRegs)
      dst_assign(t, &in->Dst[0], sat, e);
}

static void declaration(struct tr *t, const struct tgsi_full_declaration *d)
{
   unsigned first = d->Range.First, last = d->Range.Last;
   for (unsigned i = first; i <= last && i < MAXREG; i++) {
      unsigned sem = d->Declaration.Semantic ? d->Semantic.Name : TGSI_SEMANTIC_GENERIC;
      unsigned idx = d->Declaration.Semantic ? d->Semantic.Index + (i - first) : i;
      switch (d->Declaration.File) {
      case TGSI_FILE_INPUT:
         if (t->vs) {
            snprintf(t->in_name[i], 48, "bb_a%u", i);
            sb_printf(&t->decl, "layout(location = %u) in vec4 bb_a%u;\n", i, i);
         } else if (sem == TGSI_SEMANTIC_POSITION) {
            snprintf(t->in_name[i], 48, "gl_FragCoord");
         } else if (sem == TGSI_SEMANTIC_FACE) {
            snprintf(t->in_name[i], 48, "vec4(gl_FrontFacing ? 1.0 : -1.0)");
         } else {
            varying_name(t->in_name[i], sem, idx);
            sb_printf(&t->decl, "%sin vec4 %s;\n", d->Interp.Interpolate == TGSI_INTERPOLATE_CONSTANT ? "flat " : "", t->in_name[i]);
         }
         break;
      case TGSI_FILE_OUTPUT:
         t->out_sem[i] = sem;
         if (t->vs) {
            if (sem == TGSI_SEMANTIC_POSITION) snprintf(t->out_name[i], 48, "bb_pos");
            else if (sem == TGSI_SEMANTIC_PSIZE) snprintf(t->out_name[i], 48, "bb_psize");
            else if (is_varying(sem)) {
               varying_name(t->out_name[i], sem, idx);
               bool flat = t->other && fs_input_flat(&t->other->info, sem, idx);
               sb_printf(&t->decl, "%sout vec4 %s;\n", flat ? "flat " : "", t->out_name[i]);
            }
         } else {
            if (sem == TGSI_SEMANTIC_COLOR) {
               snprintf(t->out_name[i], 48, "bb_o%u", idx);
               sb_printf(&t->decl, "layout(location = %u) out vec4 bb_o%u;\n", idx, idx);
            } else if (sem == TGSI_SEMANTIC_POSITION) {
               snprintf(t->out_name[i], 48, "bb_depth");
            }
         }
         break;
      case TGSI_FILE_TEMPORARY:
         t->ntemps = MAX2(t->ntemps, i + 1);
         break;
      case TGSI_FILE_SAMPLER:
         break;
      default:
         break;
      }
   }
   if (d->Declaration.File == TGSI_FILE_TEMPORARY && last >= MAXREG)
      t->ntemps = MAX2(t->ntemps, last + 1);
}

char *bbgpu_glsl(const struct bbgpu_shader *sh, const struct bbgpu_shader *other)
{
   struct tr t = { .sh = sh, .other = other, .vs = sh->stage == PIPE_SHADER_VERTEX };
   struct tgsi_parse_context p;
   if (tgsi_parse_init(&p, sh->tokens) != TGSI_PARSE_OK)
      return NULL;
   while (!tgsi_parse_end_of_tokens(&p)) {
      tgsi_parse_token(&p);
      switch (p.FullToken.Token.Type) {
      case TGSI_TOKEN_TYPE_DECLARATION:
         declaration(&t, &p.FullToken.FullDeclaration);
         break;
      case TGSI_TOKEN_TYPE_IMMEDIATE:
         if (t.nimm < 256)
            for (int k = 0; k < 4; k++) t.imm[t.nimm][k] = p.FullToken.FullImmediate.u[k].Float;
         t.nimm++;
         break;
      case TGSI_TOKEN_TYPE_INSTRUCTION:
         instruction(&t, &p.FullToken.FullInstruction);
         break;
      }
      if (t.err)
         break;
   }
   tgsi_parse_free(&p);
   if (t.err) {
      fprintf(stderr, "bbgpu: GLSL translation failed: %s\n", t.err);
      free(t.decl.s); free(t.body.s);
      return NULL;
   }
   struct sb out = { 0 };
   sb_printf(&out, "#version 300 es\nprecision highp float;\nprecision highp int;\n");
   if (sh->const_vec4s)
      sb_printf(&out, "uniform vec4 %s[%u];\n", t.vs ? "bb_vc" : "bb_fc", MIN2(sh->const_vec4s, 256u));
   if (t.vs)
      sb_printf(&out, "uniform float bb_flip;\n");
   for (unsigned i = 0; i < 16; i++)
      if (sh->info.file_mask[TGSI_FILE_SAMPLER] & (1u << i) || t.sampler_target[i]) {
         unsigned tg = t.sampler_target[i];
         bool shadow = tg == TGSI_TEXTURE_SHADOW2D || tg == TGSI_TEXTURE_SHADOWRECT || tg == TGSI_TEXTURE_SHADOW1D;
         sb_printf(&out, "uniform %s bb_s%u;\n", shadow ? "highp sampler2DShadow" : "sampler2D", i);
      }
   if (t.decl.s)
      sb_printf(&out, "%s", t.decl.s);
   /* the FS reads varyings this VS does not write: declare and zero them (GLSL ES link rule) */
   struct sb extra = { 0 };
   if (t.vs && other) {
      for (unsigned i = 0; i < other->info.num_inputs; i++) {
         unsigned sem = other->info.input_semantic_name[i], idx = other->info.input_semantic_index[i];
         if (!is_varying(sem))
            continue;
         bool written = false;
         for (unsigned o = 0; o < sh->info.num_outputs; o++)
            if (sh->info.output_semantic_name[o] == sem && sh->info.output_semantic_index[o] == idx) written = true;
         if (!written) {
            char n[48]; varying_name(n, sem, idx);
            sb_printf(&out, "%sout vec4 %s;\n", other->info.input_interpolate[i] == TGSI_INTERPOLATE_CONSTANT ? "flat " : "", n);
            sb_printf(&extra, "  %s = vec4(0.0, 0.0, 0.0, 1.0);\n", n);
         }
      }
   }
   if (t.nimm) {
      sb_printf(&out, "const vec4 imm[%u] = vec4[%u](", t.nimm, t.nimm);
      for (unsigned i = 0; i < t.nimm && i < 256; i++)
         sb_printf(&out, "%svec4(%.9e, %.9e, %.9e, %.9e)", i ? ", " : "", t.imm[i][0], t.imm[i][1], t.imm[i][2], t.imm[i][3]);
      sb_printf(&out, ");\n");
   }
   sb_printf(&out, "void main() {\n");
   if (t.ntemps)
      sb_printf(&out, "  vec4 t[%u];\n  for (int i = 0; i < %u; i++) t[i] = vec4(0.0);\n", t.ntemps, t.ntemps);
   if (t.uses_addr)
      sb_printf(&out, "  ivec4 bb_addr = ivec4(0);\n");
   if (t.vs)
      sb_printf(&out, "  vec4 bb_pos = vec4(0.0, 0.0, 0.0, 1.0);\n  vec4 bb_psize = vec4(1.0);\n");
   else
      sb_printf(&out, "  vec4 bb_depth = vec4(0.0);\n");
   if (extra.s)
      sb_printf(&out, "%s", extra.s);
   t.indent = 1;
   if (t.body.s)
      sb_printf(&out, "%s", t.body.s);
   sb_printf(&out, "}\n");
   free(t.decl.s); free(t.body.s); free(extra.s);
   return out.fail ? (free(out.s), NULL) : out.s;
}
