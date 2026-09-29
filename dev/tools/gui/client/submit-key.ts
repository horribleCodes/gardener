export function submitOnEnter(root: ParentNode, submit: () => void): void {
  root.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.repeat || event.isComposing) return;
    const target = event.target;
    if (target instanceof HTMLTextAreaElement) {
      if (!event.ctrlKey) return;
    } else if (target instanceof HTMLInputElement && (target.type === "text" || target.type === "number")) {
      // Enter submits a single-line field. Ctrl+Enter does too.
    } else {
      return;
    }
    event.preventDefault();
    submit();
  });
}
