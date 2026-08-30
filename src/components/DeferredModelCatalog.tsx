import { useEffect, useRef, useState, type ComponentType } from "react";

const OPEN_EVENT = "syndrid:open-model-catalog";

/**
 * Keeps the catalog's public open event available at startup without loading the
 * catalog implementation or its CSS. The first open request loads the real dock,
 * then replays the same event after React has mounted its listener.
 */
export function DeferredModelCatalog() {
  const [Catalog, setCatalog] = useState<ComponentType | null>(null);
  const loadingRef = useRef<Promise<ComponentType> | null>(null);
  const replayOpenRef = useRef(false);

  useEffect(() => {
    if (Catalog) return;

    const onOpen = () => {
      replayOpenRef.current = true;
      const pending = loadingRef.current ?? import("./ModelCatalogDock").then(
        (module) => module.ModelCatalogDock,
      );
      loadingRef.current = pending;

      void pending
        .then((Component) => {
          setCatalog(() => Component);
        })
        .catch((error: unknown) => {
          loadingRef.current = null;
          replayOpenRef.current = false;
          console.error("Failed to load deferred model catalog", error);
        });
    };

    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, [Catalog]);

  useEffect(() => {
    if (!Catalog || !replayOpenRef.current) return;
    replayOpenRef.current = false;
    const frame = requestAnimationFrame(() => window.dispatchEvent(new Event(OPEN_EVENT)));
    return () => cancelAnimationFrame(frame);
  }, [Catalog]);

  return Catalog ? <Catalog /> : null;
}
