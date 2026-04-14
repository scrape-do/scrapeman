import { useEffect, useRef, useState, type ReactNode } from 'react';

export type SplitOrientation = 'horizontal' | 'vertical';

export function SplitPane({
  orientation,
  initialSize = 50,
  minSize = 20,
  maxSize = 80,
  storageKey,
  first,
  second,
}: {
  orientation: SplitOrientation;
  initialSize?: number;
  minSize?: number;
  maxSize?: number;
  storageKey?: string;
  first: ReactNode;
  second: ReactNode;
}): JSX.Element {
  const [size, setSize] = useState<number>(() => {
    if (typeof window === 'undefined' || !storageKey) return initialSize;
    const stored = localStorage.getItem(`${storageKey}:${orientation}`);
    if (stored) {
      const parsed = parseFloat(stored);
      if (!Number.isNaN(parsed) && parsed >= minSize && parsed <= maxSize) {
        return parsed;
      }
    }
    return initialSize;
  });

  const containerRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);

  useEffect(() => {
    if (storageKey) {
      localStorage.setItem(`${storageKey}:${orientation}`, String(size));
    }
  }, [size, orientation, storageKey]);

  const onMouseDown = (e: React.MouseEvent): void => {
    e.preventDefault();
    draggingRef.current = true;
    document.body.style.cursor =
      orientation === 'horizontal' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
  };

  useEffect(() => {
    const onMove = (e: MouseEvent): void => {
      if (!draggingRef.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const pct =
        orientation === 'horizontal'
          ? ((e.clientX - rect.left) / rect.width) * 100
          : ((e.clientY - rect.top) / rect.height) * 100;
      const clamped = Math.min(maxSize, Math.max(minSize, pct));
      setSize(clamped);
    };
    const onUp = (): void => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [orientation, minSize, maxSize]);

  const isHorizontal = orientation === 'horizontal';

  return (
    <div
      ref={containerRef}
      className={`flex h-full w-full overflow-hidden ${
        isHorizontal ? 'flex-row' : 'flex-col'
      }`}
    >
      <div
        className="overflow-hidden"
        style={
          isHorizontal
            ? { width: `${size}%`, minWidth: 0 }
            : { height: `${size}%`, minHeight: 0 }
        }
      >
        {first}
      </div>
      <div
        onMouseDown={onMouseDown}
        onDoubleClick={() => setSize(initialSize)}
        title="Drag to resize · double-click to reset"
        className={`group relative flex flex-shrink-0 items-center justify-center bg-line transition-colors hover:bg-accent ${
          isHorizontal ? 'w-px cursor-col-resize' : 'h-px cursor-row-resize'
        }`}
      >
        <div
          className={`absolute ${
            isHorizontal ? '-left-1.5 -right-1.5 inset-y-0' : '-top-1.5 -bottom-1.5 inset-x-0'
          }`}
        />
      </div>
      <div
        className="flex-1 overflow-hidden"
        style={isHorizontal ? { minWidth: 0 } : { minHeight: 0 }}
      >
        {second}
      </div>
    </div>
  );
}
