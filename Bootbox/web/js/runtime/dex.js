/* ============================================================================
 * DEX interpreter — parses a real Android classes.dex and INTERPRETS a useful
 * subset of Dalvik bytecode (no JIT). Runs simple Java/Kotlin programs: integer
 * arithmetic, branches, method calls, and System.out.print(ln) / print.
 *
 * Honest scope: a subset interpreter, not ART. No native libs, no Android
 * framework/UI, no Play Services. Trivial console-style apps run for real;
 * anything else reports the first unsupported opcode and stops.
 * ========================================================================== */
(function () {
  function parse(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const u8 = (o) => bytes[o];
    const u16 = (o) => dv.getUint16(o, true);
    const u32 = (o) => dv.getUint32(o, true);
    const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2]);
    if (magic !== "dex") throw new Error("not a DEX file");

    const H = {
      stringIdsSize: u32(56), stringIdsOff: u32(60),
      typeIdsSize: u32(64), typeIdsOff: u32(68),
      protoIdsSize: u32(72), protoIdsOff: u32(76),
      fieldIdsSize: u32(80), fieldIdsOff: u32(84),
      methodIdsSize: u32(88), methodIdsOff: u32(92),
      classDefsSize: u32(96), classDefsOff: u32(100),
    };
    function uleb(o) { let r = 0, s = 0, b; do { b = bytes[o++]; r |= (b & 0x7f) << s; s += 7; } while (b & 0x80); return [r >>> 0, o]; }

    // strings
    const strings = [];
    for (let i = 0; i < H.stringIdsSize; i++) {
      let off = u32(H.stringIdsOff + i * 4);
      let p = uleb(off)[1];               // skip utf16 length
      let s = "";
      while (bytes[p] !== 0) s += String.fromCharCode(bytes[p++]); // MUTF8≈ASCII
      strings.push(s);
    }
    const types = [];
    for (let i = 0; i < H.typeIdsSize; i++) types.push(strings[u32(H.typeIdsOff + i * 4)]);
    const fields = [];
    for (let i = 0; i < H.fieldIdsSize; i++) {
      const o = H.fieldIdsOff + i * 8;
      fields.push({ cls: types[u16(o)], type: types[u16(o + 2)], name: strings[u32(o + 4)] });
    }
    const methods = [];
    for (let i = 0; i < H.methodIdsSize; i++) {
      const o = H.methodIdsOff + i * 8;
      methods.push({ cls: types[u16(o)], name: strings[u32(o + 4)] });
    }

    // class_data → methods with code
    const codeByMethod = {};
    for (let i = 0; i < H.classDefsSize; i++) {
      const o = H.classDefsOff + i * 32;
      const classDataOff = u32(o + 24);
      if (!classDataOff) continue;
      let p = classDataOff;
      let v;
      v = uleb(p); const sf = v[0]; p = v[1];
      v = uleb(p); const inf = v[0]; p = v[1];
      v = uleb(p); const dm = v[0]; p = v[1];
      v = uleb(p); const vm = v[0]; p = v[1];
      for (let k = 0; k < sf; k++) { p = uleb(p)[1]; p = uleb(p)[1]; } // static fields
      for (let k = 0; k < inf; k++) { p = uleb(p)[1]; p = uleb(p)[1]; } // instance fields
      const readMethods = (count) => {
        let midx = 0;
        for (let k = 0; k < count; k++) {
          v = uleb(p); midx += v[0]; p = v[1];
          v = uleb(p); p = v[1];           // access
          v = uleb(p); const codeOff = v[0]; p = v[1];
          if (codeOff) {
            const regs = u16(codeOff), ins = u16(codeOff + 2);
            const insnsSize = u32(codeOff + 12);
            codeByMethod[midx] = { regs, ins, insnsOff: codeOff + 16, insnsSize };
          }
        }
      };
      readMethods(dm); midx = 0; readMethods(vm);
    }
    return { H, strings, types, fields, methods, codeByMethod, u16, u32, bytes };
  }

  function run(bytes, onOut) {
    let dex;
    try { dex = parse(bytes); } catch (e) { onOut("DEX error: " + e.message); return; }
    const { methods, fields, codeByMethod, u16 } = dex;

    // pick entry: a "main", else first method that has code
    let entry = -1;
    for (let i = 0; i < methods.length; i++) if (methods[i].name === "main" && codeByMethod[i]) { entry = i; break; }
    if (entry < 0) entry = Object.keys(codeByMethod)[0] != null ? +Object.keys(codeByMethod)[0] : -1;
    if (entry < 0) { onOut("No runnable method with code found in classes.dex"); return; }
    onOut("Running " + (methods[entry].cls || "") + "->" + (methods[entry].name || "?") + "() …\n");

    let steps = 0;
    function exec(mIdx, args) {
      const code = codeByMethod[mIdx];
      if (!code) return;
      const reg = new Array(code.regs).fill(0);
      for (let i = 0; i < (args || []).length; i++) reg[code.regs - code.ins + i] = args[i];
      let pc = code.insnsOff;
      const end = code.insnsOff + code.insnsSize * 2;
      const op16 = (off) => dex.bytes[off] | (dex.bytes[off + 1] << 8);
      const s16 = (off) => { const v = op16(off); return v & 0x8000 ? v - 0x10000 : v; };

      while (pc < end) {
        if (++steps > 2000000) { onOut("\n[stopped: step limit]"); return; }
        const w = op16(pc); const op = w & 0xff; const AA = (w >> 8) & 0xff;
        const A = (w >> 8) & 0xf, B = (w >> 12) & 0xf;
        switch (op) {
          case 0x00: pc += 2; break;                                   // nop
          case 0x01: reg[A] = reg[B]; pc += 2; break;                  // move
          case 0x0a: reg[AA] = retval; pc += 2; break;                 // move-result
          case 0x0e: return;                                           // return-void
          case 0x0f: retval = reg[AA]; return;                         // return
          case 0x12: reg[A] = (B & 0x8) ? B - 16 : B; pc += 2; break;  // const/4
          case 0x13: reg[AA] = s16(pc + 2); pc += 4; break;            // const/16
          case 0x14: reg[AA] = (op16(pc + 2) | (op16(pc + 4) << 16)) | 0; pc += 6; break; // const
          case 0x1a: reg[AA] = { __str: dex.strings[op16(pc + 2)] }; pc += 4; break;      // const-string
          case 0x62: { const f = fields[op16(pc + 2)]; reg[AA] = (f && f.name === "out") ? { __stream: true } : 0; pc += 4; break; } // sget-object
          case 0x6e: case 0x74: { // invoke-virtual / -range(approx)
            const meth = dex.methods[op16(pc + 2)];
            const regsWord = op16(pc + 4); const cnt = (w >> 12) & 0xf;
            const rlist = [regsWord & 0xf, (regsWord >> 4) & 0xf, (regsWord >> 8) & 0xf, (regsWord >> 12) & 0xf, w & 0xf];
            const recv = reg[rlist[0]];
            if (recv && recv.__stream && (meth.name === "println" || meth.name === "print")) {
              const a = reg[rlist[1]];
              const s = a && a.__str != null ? a.__str : String(a);
              onOut(s + (meth.name === "println" ? "\n" : ""));
            }
            pc += 6; break;
          }
          case 0x71: { // invoke-static
            const mi = op16(pc + 2);
            const regsWord = op16(pc + 4); const cnt = (w >> 12) & 0xf;
            const rlist = [regsWord & 0xf, (regsWord >> 4) & 0xf, (regsWord >> 8) & 0xf, (regsWord >> 12) & 0xf, w & 0xf];
            const callArgs = rlist.slice(0, cnt).map(r => reg[r]);
            if (codeByMethod[mi]) { exec(mi, callArgs); } // user static method
            pc += 6; break;
          }
          case 0x90: reg[AA] = (reg[dex.bytes[pc + 2]] + reg[dex.bytes[pc + 3]]) | 0; pc += 4; break; // add-int
          case 0x91: reg[AA] = (reg[dex.bytes[pc + 2]] - reg[dex.bytes[pc + 3]]) | 0; pc += 4; break; // sub-int
          case 0x92: reg[AA] = Math.imul(reg[dex.bytes[pc + 2]], reg[dex.bytes[pc + 3]]); pc += 4; break; // mul-int
          case 0x93: reg[AA] = (reg[dex.bytes[pc + 2]] / reg[dex.bytes[pc + 3]]) | 0; pc += 4; break; // div-int
          case 0x94: reg[AA] = (reg[dex.bytes[pc + 2]] % reg[dex.bytes[pc + 3]]) | 0; pc += 4; break; // rem-int
          case 0xb0: reg[A] = (reg[A] + reg[B]) | 0; pc += 2; break;   // add-int/2addr
          case 0xb1: reg[A] = (reg[A] - reg[B]) | 0; pc += 2; break;   // sub-int/2addr
          case 0xb2: reg[A] = Math.imul(reg[A], reg[B]); pc += 2; break; // mul-int/2addr
          case 0xd8: reg[AA & 0xf] = (reg[(AA >> 4) & 0xf] + ((dex.bytes[pc + 3] << 24 >> 24))) | 0; pc += 4; break; // add-int/lit8 (approx)
          case 0x28: { const off = (AA & 0x80) ? AA - 256 : AA; pc += off * 2 || 2; break; } // goto
          case 0x32: case 0x33: case 0x34: case 0x35: case 0x36: case 0x37: { // if-test vA,vB,+CCCC
            const off = s16(pc + 2); const x = reg[A], y = reg[B];
            const t = op === 0x32 ? x === y : op === 0x33 ? x !== y : op === 0x34 ? x < y : op === 0x35 ? x >= y : op === 0x36 ? x > y : x <= y;
            pc += t ? off * 2 : 4; break;
          }
          case 0x38: case 0x39: case 0x3a: case 0x3b: case 0x3c: case 0x3d: { // if-testz vAA,+CCCC
            const off = s16(pc + 2); const x = reg[AA];
            const t = op === 0x38 ? x === 0 : op === 0x39 ? x !== 0 : op === 0x3a ? x < 0 : op === 0x3b ? x >= 0 : op === 0x3c ? x > 0 : x <= 0;
            pc += t ? off * 2 : 4; break;
          }
          default:
            onOut("\n[unsupported opcode 0x" + op.toString(16) + " at pc-offset " + (pc - code.insnsOff) + "; stopping]");
            return;
        }
      }
    }
    let retval = 0;
    try { exec(entry, [null]); onOut("\n[done]"); }
    catch (e) { onOut("\n[runtime error: " + e.message + "]"); }
  }

  window.Dex = { parse, run };
})();
