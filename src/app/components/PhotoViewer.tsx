import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

// Full-screen photos, like Messages: the whole photo (never cropped) on black.
// Pinch or double-tap to zoom in (up to the photo's full detail), drag to look
// around when zoomed, swipe sideways for the next photo, swipe down or tap X to close.

interface PhotoViewerProps {
  photos: string[];
  startIndex: number;
  onClose: () => void;
}

type Point = { x: number; y: number };
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const pt = (t: { clientX: number; clientY: number }): Point => ({ x: t.clientX, y: t.clientY });

export function PhotoViewer({ photos, startIndex, onClose }: PhotoViewerProps) {
  const [index, setIndex] = useState(startIndex);
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [swipe, setSwipe] = useState<Point>({ x: 0, y: 0 }); // sideways = next photo, down = close
  const [animating, setAnimating] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const gesture = useRef<{
    mode: 'none' | 'pinch' | 'pan' | 'swipe';
    start: Point; startPan: Point; startScale: number; startDist: number; startMid: Point;
  }>({ mode: 'none', start: { x: 0, y: 0 }, startPan: { x: 0, y: 0 }, startScale: 1, startDist: 1, startMid: { x: 0, y: 0 } });
  const lastTap = useRef(0);

  // Zooming in as far as the photo's real pixels allow (at least 2.5x, at most 6x)
  const maxScale = () => {
    const img = imgRef.current;
    if (!img || !img.clientWidth) return 4;
    const natural = (img.naturalWidth / img.clientWidth) / (window.devicePixelRatio || 1);
    return Math.min(6, Math.max(2.5, natural));
  };

  const reset = () => { setScale(1); setPan({ x: 0, y: 0 }); };
  useEffect(reset, [index]);

  // Escape closes; arrow keys flip (on a computer)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') setIndex(i => Math.min(photos.length - 1, i + 1));
      if (e.key === 'ArrowLeft') setIndex(i => Math.max(0, i - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [photos.length, onClose]);

  const onTouchStart = (e: React.TouchEvent) => {
    setAnimating(false);
    const g = gesture.current;
    if (e.touches.length === 2) {
      const a = pt(e.touches[0]), b = pt(e.touches[1]);
      Object.assign(g, { mode: 'pinch', startDist: dist(a, b), startScale: scale, startPan: pan, startMid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } });
    } else if (e.touches.length === 1) {
      Object.assign(g, { mode: scale > 1 ? 'pan' : 'swipe', start: pt(e.touches[0]), startPan: pan });
    }
  };

  const onTouchMove = (e: React.TouchEvent) => {
    const g = gesture.current;
    if (g.mode === 'pinch' && e.touches.length === 2) {
      const a = pt(e.touches[0]), b = pt(e.touches[1]);
      const next = Math.min(maxScale(), Math.max(1, g.startScale * dist(a, b) / g.startDist));
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      setScale(next);
      setPan({ x: g.startPan.x + (mid.x - g.startMid.x), y: g.startPan.y + (mid.y - g.startMid.y) });
    } else if (g.mode === 'pan' && e.touches.length === 1) {
      const p = pt(e.touches[0]);
      setPan({ x: g.startPan.x + p.x - g.start.x, y: g.startPan.y + p.y - g.start.y });
    } else if (g.mode === 'swipe' && e.touches.length === 1) {
      const p = pt(e.touches[0]);
      const dx = p.x - g.start.x, dy = p.y - g.start.y;
      // Lock to whichever direction moved first: sideways flips, downward closes
      setSwipe(Math.abs(dx) > Math.abs(dy) ? { x: dx, y: 0 } : { x: 0, y: Math.max(0, dy) });
    }
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    const g = gesture.current;
    if (e.touches.length > 0) return; // still a finger down
    setAnimating(true);
    if (g.mode === 'pinch' || g.mode === 'pan') {
      if (scale <= 1.02) reset();
    } else if (g.mode === 'swipe') {
      const w = window.innerWidth;
      if (swipe.y > 120) { onClose(); return; }
      if (swipe.x < -w * 0.2 && index < photos.length - 1) setIndex(index + 1);
      else if (swipe.x > w * 0.2 && index > 0) setIndex(index - 1);
      // A quick tap (no movement): two in a row zooms in or back out
      if (Math.abs(swipe.x) < 6 && swipe.y < 6) {
        const now = Date.now();
        if (now - lastTap.current < 300) {
          if (scale > 1) reset();
          else setScale(Math.min(maxScale(), 2.5));
          lastTap.current = 0;
        } else {
          lastTap.current = now;
        }
      }
      setSwipe({ x: 0, y: 0 });
    }
    g.mode = 'none';
  };

  const fade = Math.max(0.35, 1 - swipe.y / 400);

  return createPortal(
    <div
      className="fixed inset-0 z-[70] select-none"
      style={{ background: `rgba(0,0,0,${fade})`, touchAction: 'none' }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
      // The viewer floats above everything, but taps on it still travel up through the
      // card that opened it — stop them so the card doesn't close, drag, or swipe
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onDoubleClick={() => (scale > 1 ? reset() : setScale(Math.min(maxScale(), 2.5)))}
    >
      <div className="absolute inset-0 flex items-center justify-center overflow-hidden">
        <img
          ref={imgRef}
          src={photos[index]}
          alt=""
          draggable={false}
          className="max-w-full max-h-full object-contain"
          style={{
            transform: `translate(${pan.x + swipe.x}px, ${pan.y + swipe.y}px) scale(${scale})`,
            transition: animating ? 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1)' : 'none',
          }}
          onTransitionEnd={() => setAnimating(false)}
        />
      </div>

      {/* Top bar: close, and which photo this is */}
      <div className="absolute inset-x-0 top-0 flex items-center justify-between px-3" style={{ paddingTop: 'max(12px, env(safe-area-inset-top))', opacity: fade }}>
        <button
          onClick={onClose}
          onTouchEnd={(e) => { e.stopPropagation(); onClose(); }}
          className="w-10 h-10 rounded-full bg-white/15 text-white flex items-center justify-center backdrop-blur"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>
        {photos.length > 1 && <span className="text-white/90 text-sm tabular-nums">{index + 1} of {photos.length}</span>}
        <span className="w-10" />
      </div>
    </div>,
    document.body
  );
}
