import { useState } from 'react';
import { Plus, Pencil, Trash2, Check, X, Folder as FolderIcon } from 'lucide-react';

export interface Folder { id: string; name: string }

interface FolderBarProps {
  folders: Folder[];
  counts: Record<string, number>;
  totalCount: number;
  active: string | null; // null = all favorites
  onSelect: (id: string | null) => void;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  /** A favorite is being dragged: show folders as big drop targets */
  dragActive?: boolean;
  /** The folder the dragged nudge is currently over */
  hoverId?: string | null;
}

// One row of folder chips above Favorites: All · your folders · + New folder.
// The selected folder gets small rename/delete buttons.
export function FolderBar({ folders, counts, totalCount, active, onSelect, onCreate, onRename, onDelete, dragActive, hoverId }: FolderBarProps) {
  const [draft, setDraft] = useState<string | null>(null); // non-null while naming a new folder
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

  const chip = (selected: boolean) =>
    `shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs whitespace-nowrap border transition-colors ${
      selected ? 'bg-brand-600 border-brand-600 text-white' : 'bg-white border-stone-300 text-stone-700'
    }`;

  const submitNew = () => {
    const name = draft?.trim();
    if (name) onCreate(name);
    setDraft(null);
  };

  const submitRename = () => {
    const name = renameDraft.trim();
    if (renaming && name) onRename(renaming, name);
    setRenaming(null);
  };

  // While dragging a favorite: every folder becomes a big drop target. They wrap
  // onto extra lines instead of scrolling, so none are hidden off to the side.
  if (dragActive) {
    return (
      <div className="mb-2">
        <p className="mb-1.5 text-xs text-stone-500">
          {folders.length ? 'Drop it into a folder' : 'Make a folder first with "New folder"'}
        </p>
        <div className="flex flex-wrap gap-2">
          {folders.map(folder => {
            const over = hoverId === folder.id;
            return (
              <div
                key={folder.id}
                data-drop-target={folder.id}
                className={`flex items-center gap-2 px-4 py-3 rounded-2xl border-2 text-sm transition-all duration-150 ${
                  over
                    ? 'scale-110 border-brand-500 bg-brand-100 text-brand-800 shadow-md'
                    : 'border-dashed border-brand-300 bg-white text-stone-700'
                }`}
              >
                <FolderIcon className="w-4 h-4" />
                {folder.name}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="-mx-4 px-4 mb-2 flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <button type="button" className={chip(active === null)} onClick={() => onSelect(null)}>
        All <span className="opacity-70">{totalCount}</span>
      </button>

      {folders.map(folder =>
        renaming === folder.id ? (
          <form
            key={folder.id}
            onSubmit={(e) => { e.preventDefault(); submitRename(); }}
            className="shrink-0 flex items-center gap-1 pl-3 pr-1 py-0.5 rounded-full border border-brand-400 bg-white"
          >
            <input
              autoFocus
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
              onBlur={submitRename}
              className="w-24 text-xs bg-transparent focus:outline-none"
              aria-label="Folder name"
            />
            <button type="submit" className="p-1 text-brand-600" aria-label="Save name"><Check className="w-3.5 h-3.5" /></button>
          </form>
        ) : (
          <div key={folder.id} className="shrink-0 flex items-center gap-1">
            <button type="button" className={chip(active === folder.id)} onClick={() => onSelect(folder.id)}>
              {folder.name} <span className="opacity-70">{counts[folder.id] ?? 0}</span>
            </button>
            {active === folder.id && (
              <>
                <button
                  type="button"
                  onClick={() => { setRenaming(folder.id); setRenameDraft(folder.name); }}
                  className="p-1.5 rounded-full text-stone-500 hover:bg-stone-100"
                  aria-label={`Rename ${folder.name}`}
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(`Delete the folder "${folder.name}"? The nudges in it stay in your Favorites.`)) onDelete(folder.id);
                  }}
                  className="p-1.5 rounded-full text-stone-500 hover:bg-stone-100"
                  aria-label={`Delete ${folder.name}`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </>
            )}
          </div>
        )
      )}

      {draft !== null ? (
        <form
          onSubmit={(e) => { e.preventDefault(); submitNew(); }}
          className="shrink-0 flex items-center gap-1 pl-3 pr-1 py-0.5 rounded-full border border-brand-400 bg-white"
        >
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={submitNew}
            placeholder="Folder name"
            className="w-24 text-xs bg-transparent focus:outline-none"
          />
          <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => setDraft(null)} className="p-1 text-stone-400" aria-label="Cancel">
            <X className="w-3.5 h-3.5" />
          </button>
        </form>
      ) : (
        <button type="button" onClick={() => setDraft('')} className={`${chip(false)} border-dashed text-stone-500`}>
          <Plus className="w-3.5 h-3.5" /> New folder
        </button>
      )}
    </div>
  );
}
