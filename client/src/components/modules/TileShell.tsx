import type { ReactNode } from 'react';

export function TileShell({
  title,
  control,
  stale,
  className,
  children,
}: {
  title: string;
  control?: ReactNode;
  stale?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`panel tile-panel${stale ? ' is-stale' : ''}${className ? ` ${className}` : ''}`}>
      <header className="tile-head">
        <h2 className="tile-drag" title="Drag to move">{title}</h2>
        <div className="tile-controls">{control}</div>
      </header>
      <div className="tile-body">{children}</div>
    </section>
  );
}
