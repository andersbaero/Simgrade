import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

/**
 * Shared behaviour for the search-as-you-type pickers: open/close, keyboard
 * navigation, click-outside dismissal and keeping the highlighted row in view.
 *
 * The hook owns the query and derives the match list from it, so callers pass a
 * `computeMatches` function rather than a list. Rendering is left to the caller,
 * which is the only part that really differs between picking one gem and adding
 * many items.
 */
export function useCombobox<T>(
	computeMatches: (query: string) => T[],
	commit: (item: T) => void,
	options: { closeOnCommit?: boolean; clearOnEnter?: boolean } = {},
) {
	const { closeOnCommit = true, clearOnEnter = false } = options;
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState('');
	const [highlight, setHighlight] = useState(0);
	const rootRef = useRef<HTMLDivElement>(null);
	const listRef = useRef<HTMLDivElement>(null);

	const matches = useMemo(() => computeMatches(query), [computeMatches, query]);

	useEffect(() => setHighlight(0), [query]);

	useEffect(() => {
		if (!open) return;
		const onDocumentDown = (event: MouseEvent) => {
			if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
		};
		document.addEventListener('mousedown', onDocumentDown);
		return () => document.removeEventListener('mousedown', onDocumentDown);
	}, [open]);

	useLayoutEffect(() => {
		if (!open) return;
		listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
	}, [highlight, open]);

	const close = () => {
		setQuery('');
		setOpen(false);
	};

	const choose = (item: T) => {
		commit(item);
		if (closeOnCommit) close();
	};

	const onKeyDown = (event: React.KeyboardEvent) => {
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			if (!open) {
				setOpen(true);
				return;
			}
			const step = event.key === 'ArrowDown' ? 1 : -1;
			setHighlight(current => Math.min(matches.length - 1, Math.max(0, current + step)));
		} else if (event.key === 'Enter') {
			if (!open) return;
			event.preventDefault();
			const item = matches[highlight];
			if (!item) return;
			choose(item);
			// Enter means "done with this search" — clear so the next one can be
			// typed straight away. Clicking does not clear, because picking several
			// items out of one result list is the other half of the workflow.
			if (!closeOnCommit && clearOnEnter) setQuery('');
		} else if (event.key === 'Escape') {
			close();
		}
	};

	const inputProps = {
		onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
			setQuery(event.target.value);
			setOpen(true);
		},
		onFocus: () => setOpen(true),
		onKeyDown,
		spellCheck: false,
	};

	return { open, setOpen, query, matches, highlight, setHighlight, rootRef, listRef, inputProps, choose, close };
}
