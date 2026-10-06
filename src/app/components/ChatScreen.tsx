import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';

// A nudge's conversation, full screen like a chat in Messages: the nudge pinned at the
// top, room to read, and the message box sitting right above the keyboard.

/** The part of the screen the keyboard isn't covering */
function useVisibleArea() {
  const read = () => {
    const vv = window.visualViewport;
    return { top: vv?.offsetTop ?? 0, height: vv?.height ?? window.innerHeight };
  };
  const [area, setArea] = useState(read);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => {
      setArea(read());
      // iOS scrolls the page to show the box; keep the page itself still
      if (window.scrollY) window.scrollTo(0, 0);
    };
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => { vv.removeEventListener('resize', update); vv.removeEventListener('scroll', update); };
  }, []);
  return area;
}

interface ChatScreenProps {
  title: string;
  subtitle: string;
  thumb: string | null;
  ThumbIcon: (props: { className?: string }) => ReactNode;
  onClose: () => void;
  /** The nudge itself, shown at the top of the conversation */
  pinned: ReactNode;
  composer: ReactNode;
  /** Changes when something new arrives, to scroll to the bottom */
  scrollKey: string;
  children: ReactNode;
}

export function ChatScreen({ title, subtitle, thumb, ThumbIcon, onClose, pinned, composer, scrollKey, children }: ChatScreenProps) {
  const area = useVisibleArea();
  const scrollRef = useRef<HTMLDivElement>(null);
  const keyboardUp = area.height < window.innerHeight - 120;

  // Start at the newest message, and follow new ones (and the keyboard opening)
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [scrollKey, area.height]);

  // The page behind shouldn't scroll while the chat is open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  return (
    <div
      className="fixed inset-x-0 z-50 flex flex-col bg-[#FBF6EC]"
      style={{ top: area.top, height: area.height }}
      // This lives outside the card on the page, but React still passes taps up to it — stop them here
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      role="dialog"
      aria-label={`Messages about ${title}`}
    >
      <div className="shrink-0 bg-[#FBF6EC]/95 backdrop-blur border-b border-stone-200/80" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="max-w-2xl mx-auto w-full flex items-center gap-2.5 px-2 py-2">
          <button onClick={onClose} className="p-1.5 rounded-lg active:bg-stone-200" aria-label="Back">
            <ChevronLeft className="w-7 h-7 text-blue-500" />
          </button>
          <span className="w-10 h-10 shrink-0 rounded-xl overflow-hidden bg-stone-100 text-stone-500 flex items-center justify-center">
            {thumb ? <img src={thumb} alt="" className="w-full h-full object-cover" /> : <ThumbIcon className="w-5 h-5" />}
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-[16px] font-medium text-stone-900 truncate">{title}</span>
            <span className="block text-[12px] text-stone-500 truncate">{subtitle}</span>
          </span>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
        <div className="max-w-2xl mx-auto w-full px-3.5 pt-4 pb-3">
          {pinned}
          <div className="mt-2">{children}</div>
        </div>
      </div>

      <div
        className="shrink-0 bg-[#FBF6EC]/95 backdrop-blur border-t border-stone-200/80"
        style={{ paddingBottom: keyboardUp ? 8 : 'max(env(safe-area-inset-bottom), 8px)' }}
      >
        <div className="max-w-2xl mx-auto w-full px-3 pt-2">{composer}</div>
      </div>
    </div>
  );
}
