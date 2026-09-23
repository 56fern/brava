import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Task } from "../../shared/types";
import type { CartDebugState } from "../../shared/cart-debug";

export function CartDebugModal({ task, onClose }: { task: Task; onClose: () => void }) {
  const [state, setState] = useState<CartDebugState>({ running: false, message: "Ready for a cart-only test.", snapshots: [] });
  const [selected, setSelected] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await window.brava.tasks.cartDebugState();
        if (!disposed) setState(next);
      } catch (error) { if (!disposed) setError(String(error)); }
      if (!disposed) timer = setTimeout(() => void poll(), 750);
    };
    void poll();
    return () => { disposed = true; clearTimeout(timer); void window.brava.tasks.stopCartDebug(true); };
  }, []);
  const action = async (kind: "start" | "stop" | "close") => {
    setBusy(true);
    setError("");
    try {
      if (kind === "start") { setSelected(null); setState(await window.brava.tasks.startCartDebug(task.id)); }
      else setState(await window.brava.tasks.stopCartDebug(kind === "close"));
      if (kind === "close") onClose();
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  const frame = selected === null ? state.latest : state.snapshots[selected];
  return createPortal(<div className="modal-backdrop task-log-backdrop">
    <section className="cart-debug-modal" role="dialog" aria-modal="true" aria-label="Cart-only debug viewer">
      <header><div><span className="eyebrow">HIDDEN BROWSER · CART-ONLY TEST</span><h2>{task.name}</h2></div><button disabled={busy} onClick={() => void action("close")} aria-label="Close debug viewer">×</button></header>
      <div className="cart-debug-notice">Read-only screenshots of the actual hidden browser. Uses a fresh cart and an available harvester connection, but does not display the harvester. Bypasses monitoring/queue wait for this test. No profile details are loaded, and checkout is never clicked. Stop other tasks first.</div>
      <div className="cart-debug-toolbar"><button className="primary" disabled={busy || state.running} onClick={() => void action("start")}>Run cart-only test</button><button disabled={busy || !state.running} onClick={() => void action("stop")}>Stop test</button><span role="status">{state.running ? "● Running" : "Test idle"} · {state.message}</span></div>
      {error && <p className="cart-debug-error" role="alert">{error}</p>}
      <div className="cart-debug-body"><aside><button className={selected === null ? "selected" : ""} onClick={() => setSelected(null)}>Live / latest view</button>{state.snapshots.map((item, index) => <button className={selected === index ? "selected" : ""} key={`${item.at}-${index}`} onClick={() => setSelected(index)}>{item.label}<small>{new Date(item.at).toLocaleTimeString()}</small></button>)}</aside><div className="cart-debug-preview">{frame ? <><p>{frame.label} · {new Date(frame.at).toLocaleTimeString()}<small>{frame.url}</small></p><img src={frame.image} alt={`${frame.label} — hidden task browser`} /></> : <p>Start the test to see the product and cart pages here.</p>}</div></div>
      <footer>Snapshots stay in memory only and are cleared when this viewer closes. Product/cart pages only; checkout pages are blocked.</footer>
    </section>
  </div>, document.body);
}
