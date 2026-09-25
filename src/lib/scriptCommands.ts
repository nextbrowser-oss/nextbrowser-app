// The published Hello World skill still invokes the retired `clawctl` CLI
// without a profile selector. Run this known script through the app's selected
// profile path so it cannot accidentally target Default.
export const HELLO_WORLD_SCRIPT_JS = '(()=>{const d=document.createElement("div");d.textContent="Hello, world! 👋";d.style.cssText="position:fixed;top:24px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#5b4ff2;color:#fff;font:600 16px system-ui,sans-serif;padding:14px 22px;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.35)";document.body.appendChild(d);setTimeout(()=>d.remove(),4000);return "shown";})()';

export function publicScriptJavaScript(selector: string): string | undefined {
  return selector === "hello-world.script" ? HELLO_WORLD_SCRIPT_JS : undefined;
}
