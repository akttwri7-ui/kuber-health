import { API, http } from "@/lib/api";

export async function streamSSE(path, body, onDelta) {
  const opts = { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
  let res = await fetch(`${API}${path}`, opts);
  if (res.status === 401) {
    await http.post("/auth/refresh");
    res = await fetch(`${API}${path}`, opts);
  }
  if (!res.ok) {
    let msg = "Request failed";
    try { msg = (await res.json()).detail || msg; } catch {}
    throw new Error(msg);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop();
    for (const p of parts) {
      const line = p.replace(/^data: /, "");
      if (line === "[DONE]") continue;
      try {
        const j = JSON.parse(line);
        if (j.delta) onDelta(j.delta);
        if (j.error) onDelta(`\n${j.error}`);
      } catch {}
    }
  }
}
