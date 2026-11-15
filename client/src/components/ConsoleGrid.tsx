import { Button } from '@shopify/polaris';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import GridLayout, { WidthProvider, type Layout } from 'react-grid-layout';
import { loadLayout, MOBILE_LAYOUT, saveLayout, type TileId } from '../lib/consoleLayout';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

const Grid = WidthProvider(GridLayout);

const ROW_HEIGHT = 36;
const MOBILE_MQ = '(max-width: 1000px)';

export function ConsoleGrid({ tiles }: { tiles: Record<TileId, ReactNode> }) {
  const [layout, setLayout] = useState<Layout[]>(() => loadLayout());
  const [savedFlash, setSavedFlash] = useState(false);
  const [mobile, setMobile] = useState(() => typeof window !== 'undefined' && window.matchMedia(MOBILE_MQ).matches);
  const [reducedMotion, setReducedMotion] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_MQ);
    const onMq = () => setMobile(mq.matches);
    mq.addEventListener('change', onMq);
    const rm = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onRm = () => setReducedMotion(rm.matches);
    rm.addEventListener('change', onRm);
    return () => {
      mq.removeEventListener('change', onMq);
      rm.removeEventListener('change', onRm);
    };
  }, []);

  useEffect(() => {
    if (!savedFlash) return;
    const t = window.setTimeout(() => setSavedFlash(false), 1600);
    return () => window.clearTimeout(t);
  }, [savedFlash]);

  const active = useMemo(() => (mobile ? MOBILE_LAYOUT : layout), [mobile, layout]);

  const onLayoutChange = useCallback((next: Layout[]) => {
    if (mobile) return;
    setLayout(next);
  }, [mobile]);

  const onSave = () => {
    saveLayout(layout);
    setSavedFlash(true);
  };

  return (
    <div className="console-grid-wrap">
      <Grid
        className="console-grid"
        layout={active}
        cols={mobile ? 1 : 12}
        rowHeight={ROW_HEIGHT}
        margin={[12, 12]}
        containerPadding={[0, 0]}
        draggableHandle=".tile-drag"
        isDraggable={!mobile}
        isResizable={!mobile}
        compactType="vertical"
        preventCollision={false}
        useCSSTransforms={!reducedMotion}
        onLayoutChange={onLayoutChange}
      >
        {(Object.keys(tiles) as TileId[]).map((id) => (
          <div key={id} className="console-tile">
            {tiles[id]}
          </div>
        ))}
      </Grid>
      <div className="console-grid-toolbar">
        <p className="fine console-grid-hint">
          {mobile
            ? 'Narrow layout — modules are stacked. Widen the window to drag and resize.'
            : 'Drag a module header to move. Drag the corner to resize. Click Save layout to keep it in this browser.'}
        </p>
        {!mobile && (
          <Button onClick={onSave}>{savedFlash ? 'Layout saved' : 'Save layout'}</Button>
        )}
      </div>
    </div>
  );
}
