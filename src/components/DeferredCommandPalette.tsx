import { lazy, Suspense, useEffect, useState } from "react";

const CommandPalette = lazy(async () => {
  const module = await import("./CommandPalette");
  return { default: module.CommandPalette };
});

export function DeferredCommandPalette() {
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (loaded) return;

    const requestLoad = () => setLoaded(true);
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        requestLoad();
      }
    };
    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest<HTMLButtonElement>(".workspace-toolbar .ghost-button");
      if (button?.textContent?.trim() === "⌘ K") requestLoad();
    };

    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("click", onClick);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("click", onClick);
    };
  }, [loaded]);

  if (!loaded) return null;

  return (
    <Suspense fallback={null}>
      <CommandPalette initiallyOpen />
    </Suspense>
  );
}
