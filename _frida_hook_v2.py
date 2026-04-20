"""
Hook luaL_loadbufferx in xlua.dll — V2: wait-for-process mode.
Polls for Morimens.exe, attaches ASAP, captures both bytecode AND plaintext Lua source.
"""
import frida, sys, os, time, hashlib

OUT_DIR = r"C:\Users\light\brain-in-a-vat\extracted_lua\hook_capture"
os.makedirs(OUT_DIR, exist_ok=True)

LOG = open(r"C:\Users\light\brain-in-a-vat\_frida_hook_v2.log", "w", encoding="utf-8")

def log(*a):
    msg = time.strftime("[%H:%M:%S] ") + " ".join(str(x) for x in a)
    print(msg)
    LOG.write(msg + "\n")
    LOG.flush()

# --- Wait for process ---
log("Waiting for Morimens.exe to appear...")
device = frida.get_local_device()
pid = None
while pid is None:
    procs = [p for p in device.enumerate_processes() if "morimens" in p.name.lower()]
    if procs:
        pid = procs[0].pid
        log(f"Found Morimens PID={pid}, waiting 3s for xlua.dll to load...")
        time.sleep(3)  # give DLLs time to load
        break
    time.sleep(0.5)

log(f"Attaching to PID={pid}")
session = frida.attach(pid)

# Hook script: intercept luaL_loadbufferx AND xluaL_loadbuffer
# V2 change: also capture plaintext Lua source (not just bytecode)
script_code = r"""
var luaL_loadbufferx = null;
var xluaL_loadbuffer = null;

// Try global export first
try {
    luaL_loadbufferx = Module.getGlobalExportByName("luaL_loadbufferx");
} catch(e) {}

// Try xlua.dll specifically
try {
    var m = Process.getModuleByName("xlua.dll");
    var exps = m.enumerateExports();
    for (var i = 0; i < exps.length; i++) {
        if (exps[i].name === "luaL_loadbufferx" && !luaL_loadbufferx) {
            luaL_loadbufferx = exps[i].address;
        }
        if (exps[i].name === "xluaL_loadbuffer") {
            xluaL_loadbuffer = exps[i].address;
        }
    }
} catch(e) {
    send({error: "xlua.dll not found: " + e.toString()});
}

function handleLoad(tag, buff, sz, namePtr) {
    try {
        var size = sz.toInt32 ? sz.toInt32() : parseInt(sz.toString());
        if (size <= 0 || size > 50 * 1024 * 1024) return;

        var bytes = buff.readByteArray(size);
        var name = namePtr.isNull() ? "" : namePtr.readCString();

        // V2: capture BOTH bytecode (1B 4C 75 61) AND plaintext source
        var head = new Uint8Array(bytes.slice(0, 6));
        var isBytecode = (head[0] === 0x1B && head[1] === 0x4C && head[2] === 0x75 && head[3] === 0x61);
        var isSource = false;
        if (!isBytecode) {
            // Check if it looks like Lua source (starts with common patterns)
            var firstChar = head[0];
            // printable ASCII that could start a Lua file
            if (firstChar >= 0x20 && firstChar <= 0x7E) {
                isSource = true;
            }
        }

        if (!isBytecode && !isSource) return;

        send({tag: tag, name: name, size: size, type: isBytecode ? "bytecode" : "source"}, bytes);
    } catch(e) {
        send({error: e.toString(), tag: tag});
    }
}

if (luaL_loadbufferx) {
    Interceptor.attach(luaL_loadbufferx, {
        onEnter: function(args) {
            handleLoad("loadbufferx", args[1], args[2], args[3]);
        }
    });
    send({info: "hooked luaL_loadbufferx @ " + luaL_loadbufferx.toString()});
} else {
    send({info: "luaL_loadbufferx NOT FOUND"});
}

if (xluaL_loadbuffer) {
    Interceptor.attach(xluaL_loadbuffer, {
        onEnter: function(args) {
            handleLoad("xluaL_loadbuffer", args[1], args[2], args[3]);
        }
    });
    send({info: "hooked xluaL_loadbuffer @ " + xluaL_loadbuffer.toString()});
} else {
    send({info: "xluaL_loadbuffer NOT FOUND"});
}
"""

# Preload existing hashes for dedup
seen_hashes = set()
for d in [OUT_DIR, r"C:\Users\light\brain-in-a-vat\extracted_lua\plaintext_from_memory"]:
    if not os.path.isdir(d):
        continue
    for f in os.listdir(d):
        p = os.path.join(d, f)
        try:
            with open(p, "rb") as fh:
                seen_hashes.add(hashlib.sha1(fh.read()).hexdigest())
        except Exception:
            pass
log(f"Preloaded {len(seen_hashes)} hashes to dedupe")

counters = {"total": 0, "new": 0, "dup": 0, "src_new": 0}

def on_message(msg, data):
    if msg["type"] == "error":
        log("[frida err]", msg.get("description"))
        return
    payload = msg.get("payload", {})
    if "info" in payload:
        log("[info]", payload["info"])
        return
    if "error" in payload:
        log("[hook err]", payload["error"], "tag=", payload.get("tag"))
        return
    if data is None:
        return
    counters["total"] += 1
    h = hashlib.sha1(data).hexdigest()
    if h in seen_hashes:
        counters["dup"] += 1
        return
    seen_hashes.add(h)
    name = payload.get("name", "").strip()
    ftype = payload.get("type", "bytecode")
    # sanitize name
    safe = "".join(c if c.isalnum() or c in "._-" else "_" for c in name)
    if not safe or safe.startswith("."):
        safe = f"anon_{h[:10]}"

    if ftype == "source":
        if not safe.endswith(".lua"):
            safe += ".lua"
        out = os.path.join(OUT_DIR, "src_" + safe)
        counters["src_new"] += 1
    else:
        if not safe.endswith(".lua") and not safe.endswith(".luac"):
            safe += ".lua"
        out = os.path.join(OUT_DIR, safe + "c")

    n = 2
    while os.path.exists(out):
        base, ext = os.path.splitext(out)
        out = base.rstrip("0123456789").rstrip("_") + f"_{n}" + ext
        n += 1

    with open(out, "wb") as f:
        f.write(data)
    counters["new"] += 1
    tag_str = payload.get("tag", "?")
    log(f"[+{counters['new']:04d}] {tag_str} [{ftype}] name='{name}' size={payload.get('size')} -> {os.path.basename(out)}")

script = session.create_script(script_code)
script.on("message", on_message)
script.load()

log("Hook V2 installed. Listening... (Ctrl+C to stop)")
log("Navigate through ALL game screens to trigger loads.")
log(f"Current stats: {counters}")

try:
    last_report = time.time()
    while True:
        time.sleep(1)
        # periodic status every 30s
        if time.time() - last_report > 30:
            log(f"[status] total={counters['total']} new={counters['new']} dup={counters['dup']} src={counters['src_new']}")
            last_report = time.time()
except KeyboardInterrupt:
    pass

log(f"\nFinal counters: {counters}")
session.detach()
LOG.close()
