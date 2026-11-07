// Adapted from 0nliner/fractalUI, MIT; see UPSTREAM.md and LICENSE.
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  // Псевдоним: глобальный DOM-овский KeyboardEvent тоже нужен — для оконных
  // обработчиков F2 и Escape.
  type KeyboardEvent as KeyboardEvent_,
  type MouseEvent as MouseEvent_,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import * as s from './treeStyles';
import './tree.css';

/** Узел дерева. Дети задаются вложенностью, а не parentId — так дешевле рендер. */
export type TreeNode = {
  id: string;
  label: string;
  ariaLabel?: string;
  children?: TreeNode[];
  icon?: ReactNode;
  /** Правая часть строки: чипы, счётчики, индикаторы. */
  meta?: ReactNode;
  isDisabled?: boolean;
  /**
   * Скрытый текст для поиска: описание, регион, теги — всё, по чему узел должен
   * находиться, но что не помещается в строку. Подсвечивается только `label`,
   * потому что подсвечивать нечего в тексте, которого на экране нет.
   */
  searchText?: string;
  /**
   * Доменный объект узла. Из него `facets` читают значения для фильтра
   * (тип/теги/флаги), не зная деталей на уровне кита. Потребитель кладёт сюда
   * свою модель и кастует в предикатах фасета: `(node.data as MyItem).tags`.
   */
  data?: unknown;
};

/** Куда именно бросили узел относительно цели. */
/**
 * Тип перетаскиваемой строки дерева.
 *
 * Внутренний перенос (смена порядка и вложенности) обходится состоянием
 * компонента, но вытащить строку НАРУЖУ — на холст, в другой список — так
 * нельзя: сторонний приёмник получит пустое событие. Поэтому id узла кладётся
 * ещё и в dataTransfer, а по составу типов приёмник решает, принимать ли дроп.
 * Содержимое в `dragover` недоступно — браузер отдаёт только `types`.
 */
export const TREE_MIME = 'application/x-fractalui-tree';

export type DropPosition = 'before' | 'inside' | 'after';

export type TreeDropEvent = {
  dragId: string;
  targetId: string;
  position: DropPosition;
};

export type TreeMenuItem = {
  id: string;
  label?: string;
  shortcut?: string;
  icon?: ReactNode;
  danger?: boolean;
  isDisabled?: boolean;
  /** Разделитель между группами действий (label/onSelect игнорируются). */
  separator?: boolean;
  /** Требует подтверждения прямо в меню (вместо window.confirm). */
  confirm?: string;
  /**
   * Вложенные пункты. Один уровень: «Добавить узел ▸ Локация / Папка / …».
   * Глубже не пускаем намеренно — многоуровневые меню мышью неудобны, и в
   * плотном интерфейсе второй уровень уже некуда раскрывать.
   */
  items?: TreeMenuItem[];
  onSelect?: (node: TreeNode) => void;
};

/**
 * Управление деревом, доступное действиям контекст-меню. Пробрасывается в
 * builder `menuItems(node, controls)`, чтобы пункт мог запустить встроенное
 * поведение (инлайн-переименование, раскрытие/сворачивание поддерева, выбор),
 * которое живёт во внутреннем состоянии дерева.
 */
export interface TreeControls {
  /** Запустить инлайн-переименование узла (как F2 / двойной клик). */
  startRename: (id: string) => void;
  /** Раскрыть/свернуть один узел. */
  setExpanded: (id: string, open: boolean) => void;
  /** Раскрыть узел и всё его поддерево. */
  expandAll: (id: string) => void;
  /** Свернуть узел и всё его поддерево. */
  collapseAll: (id: string) => void;
  /** Программно выбрать узел (эквивалент клика). */
  select: (id: string) => void;
}

// ── Фасеты фильтра ───────────────────────────────────────────────────
// Декларативный фильтр по узлам. Кит рисует чипы/инпут и прунит переданные
// `nodes` в памяти (предки совпадений сохраняются), сам домен не зная —
// значения читаются колбэком `get` из `node.data`. Слой L1: без сети и стора.

type TreeFacetBase = {
  /** Ключ фасета — под ним хранится состояние выбора. */
  id: string;
  /** Подпись (у toggle — текст пилюли). */
  label?: string;
};

/** Тумблер: оставить только узлы, у которых `get(node) === matchValue`. */
export type TreeToggleFacet = TreeFacetBase & {
  kind: 'toggle';
  icon?: ReactNode;
  get: (node: TreeNode) => boolean;
  /** Что считать «включено». По умолчанию `true`. */
  matchValue?: boolean;
};

/** Чипы (мультивыбор, ИЛИ внутри): узел проходит, если его значение выбрано. */
export type TreeChipsFacet = TreeFacetBase & {
  kind: 'chips';
  options: { value: string; label: string; icon?: ReactNode }[];
  get: (node: TreeNode) => string | string[] | null | undefined;
};

/** Теги: инпут «+ тег» с автоподсказками; узел проходит по `any`/`all`. */
export type TreeTagsFacet = TreeFacetBase & {
  kind: 'tags';
  placeholder?: string;
  /** `any` (по умолчанию) — хотя бы один тег; `all` — все выбранные. */
  match?: 'any' | 'all';
  get: (node: TreeNode) => string[];
};

export type TreeFacet = TreeToggleFacet | TreeChipsFacet | TreeTagsFacet;

/** Состояние выбора по фасетам: id → boolean (toggle) | string[] (chips/tags). */
export type TreeFilterState = Record<string, boolean | string[]>;

export type TreeProps = {
  label?: string;
  className?: string;
  canDrop?: (event: TreeDropEvent) => boolean;
  nodes: TreeNode[];
  selectedId?: string | null;
  onSelect?: (node: TreeNode) => void;

  /**
   * Мультивыделение строк (Ctrl/Shift+ЛКМ) — для деревьев, где действие
   * применяется сразу к нескольким узлам: перенести, сгруппировать, удалить.
   *
   * Это НЕ `checkedIds`: чекбоксы — постоянная отметка «эти интересны», а
   * выделение строк живёт ровно до следующего клика. Когда задан, `selectedId`
   * игнорируется; списки на одиночном выборе продолжают работать как раньше.
   */
  selectedIds?: string[];
  onSelectionChange?: (ids: string[]) => void;

  /**
   * Двойной клик по строке. Когда задан — он важнее инлайн-переименования:
   * в деревьях-документах двойной клик открывает узел насовсем, а переименовать
   * привычнее по F2 и из меню.
   */
  onActivate?: (node: TreeNode) => void;

  /** Множественный выбор чекбоксами. Не задан — чекбоксов нет. */
  checkedIds?: string[];
  onCheckedChange?: (ids: string[]) => void;

  expandedIds?: string[];
  onExpandedChange?: (ids: string[]) => void;
  /** Раскрыть всё при первом показе. */
  defaultExpandAll?: boolean;

  /** Поиск с автораскрытием совпавших ветвей. Не задан — строки поиска нет. */
  searchable?: boolean;
  query?: string;
  onQueryChange?: (query: string) => void;
  searchPlaceholder?: string;

  /**
   * Фасетный фильтр. Не задан — фильтра нет (полная обратная совместимость).
   * Иконка-фильтр появляется справа от поиска и раскрывает панель под ним;
   * узлы прунятся по выбранным фасетам с сохранением предков, совпадения
   * авто-раскрываются, перетаскивание на время фильтра выключается.
   */
  facets?: TreeFacet[];
  /** Иконка кнопки фильтра (кит своих не тянет). По умолчанию — воронка. */
  filterIcon?: ReactNode;

  /** Перетаскивание. Без обработчика узлы не таскаются. */
  onDrop?: (e: TreeDropEvent) => void;
  /** Можно ли тащить строку. По умолчанию — только когда задан onDrop. */
  canDrag?: (node: TreeNode) => boolean;
  /** Что положить в dataTransfer: ключ — MIME, значение — строка. */
  dragData?: (node: TreeNode) => Record<string, string> | null;

  /** Инлайн-переименование по F2 или из меню. */
  onRename?: (node: TreeNode, name: string) => void;

  /** Пункты контекстного меню. Функция — чтобы набор зависел от узла. */
  /**
   * Пункты контекст-меню (ПКМ по строке) для конкретного узла. `controls` даёт
   * доступ к встроенному поведению дерева (переименование, раскрытие поддерева,
   * выбор). Возврат `[]` — меню не показывается. Аддитивно: без пропа ПКМ не
   * перехватывается.
   */
  menuItems?: (node: TreeNode, controls: TreeControls) => TreeMenuItem[];

  emptyText?: string;
  /** Иконки задаёт потребитель: кит не тянет иконочную библиотеку. */
  renderSwitcher?: (expanded: boolean) => ReactNode;
};

// ── помощники ────────────────────────────────────────────────────────
function collectIds(nodes: TreeNode[], acc: string[] = []): string[] {
  for (const n of nodes) {
    acc.push(n.id);
    if (n.children?.length) collectIds(n.children, acc);
  }
  return acc;
}

/** Id строк в том порядке, в каком они реально нарисованы на экране. */
function visibleRowIds(nodes: TreeNode[], expanded: string[], acc: string[] = []): string[] {
  for (const n of nodes) {
    acc.push(n.id);
    if (n.children?.length && expanded.includes(n.id)) {
      visibleRowIds(n.children, expanded, acc);
    }
  }
  return acc;
}

function findNode(nodes: TreeNode[], id: string): TreeNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const hit = n.children?.length ? findNode(n.children, id) : null;
    if (hit) return hit;
  }
  return null;
}

/**
 * Отбор по подстроке: ветвь остаётся, если совпал сам узел ИЛИ любой потомок.
 * Иначе поиск по вложенным данным бесполезен — родители скрывают находки.
 */
function filterTree(nodes: TreeNode[], needle: string): TreeNode[] {
  if (!needle) return nodes;
  const out: TreeNode[] = [];
  for (const n of nodes) {
    const kids = n.children?.length ? filterTree(n.children, needle) : [];
    const hit =
      n.label.toLowerCase().includes(needle) ||
      !!n.searchText?.toLowerCase().includes(needle);
    if (hit || kids.length) out.push({ ...n, children: kids.length ? kids : n.children });
  }
  return out;
}

/** Подсветка совпадения — без dangerouslySetInnerHTML. */
function highlight(label: string, needle: string): ReactNode {
  if (!needle) return label;
  const at = label.toLowerCase().indexOf(needle);
  if (at < 0) return label;
  return (
    <>
      {label.slice(0, at)}
      <mark className={s.match}>{label.slice(at, at + needle.length)}</mark>
      {label.slice(at + needle.length)}
    </>
  );
}

/** Проходит ли узел один фасет при выбранном значении `sel`. Пустой выбор — да. */
function facetMatch(f: TreeFacet, node: TreeNode, sel: boolean | string[] | undefined): boolean {
  if (f.kind === 'toggle') {
    if (sel !== true) return true;
    return f.get(node) === (f.matchValue ?? true);
  }
  if (f.kind === 'chips') {
    const arr = Array.isArray(sel) ? sel : [];
    if (arr.length === 0) return true;
    const raw = f.get(node);
    const vals = Array.isArray(raw) ? raw : raw != null ? [raw] : [];
    return vals.some((v) => arr.includes(v));
  }
  const arr = Array.isArray(sel) ? sel : [];
  if (arr.length === 0) return true;
  const nodeTags = f.get(node) ?? [];
  return f.match === 'all' ? arr.every((t) => nodeTags.includes(t)) : arr.some((t) => nodeTags.includes(t));
}

/** Прунит дерево по фасетам (И между фасетами), сохраняя предков совпадений. */
function pruneByFacets(
  nodes: TreeNode[],
  facets: TreeFacet[],
  state: TreeFilterState,
): TreeNode[] {
  const out: TreeNode[] = [];
  for (const n of nodes) {
    const kids = n.children?.length ? pruneByFacets(n.children, facets, state) : [];
    const selfKeep = facets.every((f) => facetMatch(f, n, state[f.id]));
    if (selfKeep || kids.length) out.push({ ...n, children: kids });
  }
  return out;
}

/** Воронка — иконка кнопки фильтра по умолчанию (кит не тянет иконочную либу). */
const DEFAULT_FILTER_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
  </svg>
);
const CLOSE_ICON = (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" aria-hidden>
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

const DEFAULT_SWITCHER = (expanded: boolean) => (
  <span aria-hidden style={{ fontSize: 10, lineHeight: 1 }}>{expanded ? '▾' : '▸'}</span>
);

/**
 * Иерархический список: раскрытие, выделение, множественный выбор,
 * перетаскивание с защитой от циклов, инлайн-переименование, поиск и
 * контекстное меню.
 *
 * Своя реализация, а не обёртка над rc-tree: тот тащит собственный CSS, который
 * дерётся со стилями кита, и навязывает свою модель данных. Здесь наружу
 * торчит ровно то, что нужно потребителю.
 */
export function Tree({
  label = "Tree",
  className = "",
  canDrop,
  nodes,
  selectedId,
  onSelect,
  selectedIds,
  onSelectionChange,
  onActivate,
  checkedIds,
  onCheckedChange,
  expandedIds,
  onExpandedChange,
  defaultExpandAll,
  searchable,
  query: controlledQuery,
  onQueryChange,
  searchPlaceholder = 'Поиск',
  facets,
  filterIcon,
  onDrop,
  canDrag,
  dragData,
  onRename,
  menuItems,
  emptyText = 'Пусто',
  renderSwitcher = DEFAULT_SWITCHER,
}: TreeProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [innerExpanded, setInnerExpanded] = useState<string[]>(() =>
    defaultExpandAll ? collectIds(nodes) : [],
  );
  const expanded = expandedIds ?? innerExpanded;
  const setExpanded = useCallback(
    (ids: string[]) => (onExpandedChange ? onExpandedChange(ids) : setInnerExpanded(ids)),
    [onExpandedChange],
  );

  const [innerQuery, setInnerQuery] = useState('');
  const query = controlledQuery ?? innerQuery;
  const setQuery = onQueryChange ?? setInnerQuery;
  const needle = query.trim().toLowerCase();

  // Фасетный фильтр — внутреннее состояние (как и поиск).
  const hasFacets = !!facets?.length;
  const [panelOpen, setPanelOpen] = useState(false);
  const [facetState, setFacetState] = useState<TreeFilterState>({});
  const [tagDraft, setTagDraft] = useState<Record<string, string>>({});
  const [tagFocus, setTagFocus] = useState<string | null>(null);

  const facetsActive =
    !!facets &&
    facets.some((f) => {
      const v = facetState[f.id];
      return f.kind === 'toggle' ? v === true : Array.isArray(v) && v.length > 0;
    });

  const visible = useMemo(() => {
    let v = filterTree(nodes, needle);
    if (facets && facetsActive) v = pruneByFacets(v, facets, facetState);
    return v;
  }, [nodes, needle, facets, facetsActive, facetState]);

  // Поиск/фильтр сами раскрывают ветви — иначе находки под свёрнутыми узлами.
  const searchExpanded = useMemo(
    () => (needle || facetsActive ? collectIds(visible) : null),
    [needle, facetsActive, visible],
  );
  const effectiveExpanded = searchExpanded ?? expanded;

  // Перетаскивание на время активного фильтра выключаем: порядок в срезе неоднозначен.
  const canDropNow = !!onDrop && !facetsActive && !needle;

  // Значения тег-фасетов для автоподсказок: уникальные из get() по всему дереву.
  const flatNodes = useMemo(() => {
    const acc: TreeNode[] = [];
    const walk = (l: TreeNode[]) => {
      for (const n of l) {
        acc.push(n);
        if (n.children?.length) walk(n.children);
      }
    };
    walk(nodes);
    return acc;
  }, [nodes]);
  const facetTagValues = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const f of facets ?? []) {
      if (f.kind !== 'tags') continue;
      const set = new Set<string>();
      for (const n of flatNodes) for (const v of f.get(n) ?? []) set.add(v);
      map[f.id] = Array.from(set).sort((a, b) => a.localeCompare(b, 'ru'));
    }
    return map;
  }, [facets, flatNodes]);

  const toggleFacet = (id: string) =>
    setFacetState((st) => ({ ...st, [id]: st[id] === true ? false : true }));
  const toggleChip = (id: string, value: string) =>
    setFacetState((st) => {
      const arr = Array.isArray(st[id]) ? (st[id] as string[]) : [];
      return { ...st, [id]: arr.includes(value) ? arr.filter((x) => x !== value) : [...arr, value] };
    });
  const addFacetTag = (id: string, raw: string) => {
    const tag = raw.trim().toLowerCase();
    setTagDraft((d) => ({ ...d, [id]: '' }));
    if (!tag) return;
    setFacetState((st) => {
      const arr = Array.isArray(st[id]) ? (st[id] as string[]) : [];
      return arr.includes(tag) ? st : { ...st, [id]: [...arr, tag] };
    });
  };
  const removeFacetTag = (id: string, tag: string) =>
    setFacetState((st) => {
      const arr = Array.isArray(st[id]) ? (st[id] as string[]) : [];
      return { ...st, [id]: arr.filter((x) => x !== tag) };
    });
  const resetFacets = () => {
    setFacetState({});
    setQuery('');
  };

  // Выделение: множественное, если владелец его дал, иначе одиночное.
  const multi = !!selectedIds;
  const selection = selectedIds ?? (selectedId ? [selectedId] : []);
  const isSelected = (id: string) => selection.includes(id);

  /** Якорь диапазона для Shift — последняя строка, выбранная без Shift. */
  const anchorRef = useRef<string | null>(null);

  const handleRowClick = (node: TreeNode, e: MouseEvent_) => {
    if (node.isDisabled) return;
    if (!multi) {
      onSelect?.(node);
      return;
    }
    // Порядок строк берём из отрисованного списка, а не из модели: свёрнутые
    // ветви и фильтр поиска убирают узлы с экрана, и диапазон по модели
    // захватил бы то, чего пользователь не видит.
    const order = visibleRowIds(visible, effectiveExpanded);
    const additive = e.ctrlKey || e.metaKey;

    if (e.shiftKey && anchorRef.current) {
      const from = order.indexOf(anchorRef.current);
      const to = order.indexOf(node.id);
      if (from >= 0 && to >= 0) {
        const [a, b] = from < to ? [from, to] : [to, from];
        const range = order.slice(a, b + 1);
        onSelectionChange?.(additive ? [...new Set([...selection, ...range])] : range);
        onSelect?.(node);
        return;
      }
    }

    anchorRef.current = node.id;
    if (additive) {
      onSelectionChange?.(
        isSelected(node.id) ? selection.filter((x) => x !== node.id) : [...selection, node.id],
      );
    } else {
      onSelectionChange?.([node.id]);
    }
    onSelect?.(node);
  };

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropHint, setDropHint] = useState<{ id: string; pos: DropPosition } | null>(null);
  const [menu, setMenu] = useState<{ node: TreeNode; x: number; y: number } | null>(null);

  const toggle = (id: string) =>
    setExpanded(
      effectiveExpanded.includes(id)
        ? effectiveExpanded.filter((x) => x !== id)
        : [...effectiveExpanded, id],
    );

  const startRename = useCallback((node: TreeNode) => {
    setRenamingId(node.id);
    setDraft(node.label);
  }, []);

  const commitRename = (node: TreeNode) => {
    const name = draft.trim();
    setRenamingId(null);
    if (name && name !== node.label) onRename?.(node, name);
  };

  // Управление деревом для действий контекст-меню (см. TreeControls).
  const controls = useMemo<TreeControls>(
    () => ({
      startRename: (id) => {
        const n = findNode(nodes, id);
        if (n) startRename(n);
      },
      setExpanded: (id, open) =>
        setExpanded(open ? [...new Set([...expanded, id])] : expanded.filter((x) => x !== id)),
      expandAll: (id) => {
        const n = findNode(nodes, id);
        if (n) setExpanded([...new Set([...expanded, ...collectIds([n])])]);
      },
      collapseAll: (id) => {
        const n = findNode(nodes, id);
        if (!n) return;
        const sub = new Set(collectIds([n]));
        setExpanded(expanded.filter((x) => !sub.has(x)));
      },
      select: (id) => {
        const n = findNode(nodes, id);
        if (!n) return;
        onSelect?.(n);
        if (multi) onSelectionChange?.([id]);
      },
    }),
    [nodes, expanded, setExpanded, startRename, onSelect, multi, onSelectionChange],
  );

  // F2 переименовывает выделенное — привычно по файловым менеджерам.
  // При мультивыделении переименовывается последний выбранный: у остальных
  // имена разные, и один инпут на всех смысла не имеет.
  const renameTargetId = selection.length ? selection[selection.length - 1] : null;
  useEffect(() => {
    if (!onRename) return;
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (typing || e.code !== 'F2' || !renameTargetId || !rootRef.current?.contains(el)) return;
      const node = findNode(nodes, renameTargetId);
      if (node) {
        e.preventDefault();
        startRename(node);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nodes, renameTargetId, onRename, startRename]);

  /**
   * Клавиатура на строке. Стрелки ходят по DOM, а не по модели: список видимых
   * строк уже посчитан рендером с учётом свёрнутых веток и фильтра поиска,
   * дублировать эту логику в обход разметки — лишний источник расхождений.
   */
  const handleRowKey = (e: KeyboardEvent_<HTMLElement>, node: TreeNode) => {
    if (e.target !== e.currentTarget && (e.target as HTMLElement).closest("button,input")) return;
    const hasKids = !!node.children?.length;
    const isOpen = effectiveExpanded.includes(node.id);

    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (node.isDisabled) return;
      // В мультирежиме выделение живёт в onSelectionChange: звать только
      // onSelect значило бы, что с клавиатуры дерево не выделяет вообще.
      if (multi) {
        onSelectionChange?.(
          e.ctrlKey || e.metaKey
            ? isSelected(node.id)
              ? selection.filter((x) => x !== node.id)
              : [...selection, node.id]
            : [node.id],
        );
        anchorRef.current = node.id;
      }
      onSelect?.(node);
      return;
    }
    // Ctrl/Cmd+A — выделить все видимые строки (как в VSCode).
    if (multi && (e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
      e.preventDefault();
      onSelectionChange?.(visibleRowIds(visible, effectiveExpanded));
      return;
    }
    if (e.key === 'ArrowRight' && hasKids && !isOpen) {
      e.preventDefault();
      toggle(node.id);
      return;
    }
    if (e.key === 'ArrowLeft' && hasKids && isOpen) {
      e.preventDefault();
      toggle(node.id);
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;

    e.preventDefault();
    const list = e.currentTarget.closest('[role="tree"]');
    if (!list) return;
    const all = [...list.querySelectorAll<HTMLElement>('[role="treeitem"]')];
    const nextIdx = all.indexOf(e.currentTarget) + (e.key === 'ArrowDown' ? 1 : -1);
    const nextEl = all[nextIdx];
    if (!nextEl) return;
    nextEl.focus();
    // VSCode: Shift+стрелка расширяет выделение от якоря до новой строки
    // (порядок DOM-строк совпадает с visibleRowIds).
    if (multi && e.shiftKey) {
      const order = visibleRowIds(visible, effectiveExpanded);
      const from = order.indexOf(anchorRef.current ?? node.id);
      if (from >= 0 && order[nextIdx]) {
        const [a, b] = from < nextIdx ? [from, nextIdx] : [nextIdx, from];
        onSelectionChange?.(order.slice(a, b + 1));
      }
    }
  };

  /** Бросить узел внутрь собственного потомка — это кольцо. */
  const isDescendant = (ancestorId: string, maybeChildId: string): boolean => {
    const a = findNode(nodes, ancestorId);
    if (!a?.children?.length) return false;
    return collectIds(a.children).includes(maybeChildId);
  };

  const handleDragOver = (e: DragEvent, node: TreeNode) => {
    if (!canDropNow || !dragId || dragId === node.id) return;
    if (isDescendant(dragId, node.id)) return; // цикл
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const offset = (e.clientY - r.top) / r.height;
    const pos: DropPosition = offset < 0.25 ? 'before' : offset > 0.75 ? 'after' : 'inside';
    if (canDrop && !canDrop({ dragId, targetId: node.id, position: pos })) { setDropHint(null); e.dataTransfer.dropEffect = 'none'; return; }
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    setDropHint({ id: node.id, pos });
  };

  const handleDrop = (e: DragEvent, node: TreeNode) => {
    e.preventDefault();
    const hint = dropHint;
    setDropHint(null);
    const from = dragId;
    setDragId(null);
    if (!canDropNow || !from || !hint || hint.id !== node.id || from === node.id) return;
    if (isDescendant(from, node.id)) return;
    const drop = { dragId: from, targetId: node.id, position: hint.pos };
    if (canDrop && !canDrop(drop)) return;
    onDrop?.(drop);
  };

  const rows = (list: TreeNode[], depth: number): ReactNode[] =>
    list.flatMap((node) => {
      const hasKids = !!node.children?.length;
      const isOpen = effectiveExpanded.includes(node.id);
      const checked = checkedIds?.includes(node.id) ?? false;
      const hint = dropHint?.id === node.id ? dropHint.pos : undefined;

      const row = (
        <div
          key={node.id}
          className={s.row}
          style={{ paddingLeft: depth * 14 + 4 }}
          data-selected={isSelected(node.id) ? 'true' : undefined}
          data-checked={checked ? 'true' : undefined}
          data-drop={hint}
          data-dragging={dragId === node.id ? 'true' : undefined}
          role="treeitem"
          aria-label={node.ariaLabel ?? node.label}
          aria-level={depth + 1}
          data-node-id={node.id}
          aria-expanded={hasKids ? isOpen : undefined}
          aria-selected={isSelected(node.id)}
          tabIndex={0}
          draggable={(canDrag ? canDrag(node) : !!onDrop) && canDropNow && !node.isDisabled}
          onDragStart={(e) => {
            setDragId(node.id);
            // Полезная нагрузка для приёмников ВНЕ дерева. Внутренний перенос
            // ею не пользуется — он работает от dragId.
            e.dataTransfer.effectAllowed = 'copyMove';
            e.dataTransfer.setData(TREE_MIME, node.id);
            e.dataTransfer.setData('text/plain', node.label);
            for (const [mime, value] of Object.entries(dragData?.(node) ?? {})) {
              e.dataTransfer.setData(mime, value);
            }
            e.dataTransfer.setDragImage?.(e.currentTarget, 12, 12);
          }}
          onDragEnd={() => {
            setDragId(null);
            setDropHint(null);
          }}
          onDragOver={(e) => handleDragOver(e, node)}
          onDragLeave={() => setDropHint((h) => (h?.id === node.id ? null : h))}
          onDrop={(e) => handleDrop(e, node)}
          onClick={(e) => handleRowClick(node, e)}
          onKeyDown={(e) => handleRowKey(e, node)}
          onDoubleClick={() => {
            if (node.isDisabled) return;
            if (onActivate) onActivate(node);
            else if (onRename) startRename(node);
          }}
          onContextMenu={(e) => {
            if (!menuItems) return;
            e.preventDefault();
            setMenu({ node, x: e.clientX, y: e.clientY });
          }}
        >
          {hasKids ? (
            <span
              className={s.switcher}
              role="button"
              aria-label={`${isOpen ? "Collapse" : "Expand"} ${node.ariaLabel ?? node.label}`}
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation();
                toggle(node.id);
              }}
            >
              {renderSwitcher(isOpen)}
            </span>
          ) : (
            <span className={s.switcherPlaceholder} />
          )}

          {checkedIds && (
            <input
              type="checkbox"
              className={s.checkbox}
              checked={checked}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) =>
                onCheckedChange?.(
                  e.target.checked
                    ? [...checkedIds, node.id]
                    : checkedIds.filter((x) => x !== node.id),
                )
              }
            />
          )}

          {node.icon ? <span className={s.icon}>{node.icon}</span> : null}

          {renamingId === node.id ? (
            <input
              className={s.renameInput}
              value={draft}
              autoFocus
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => commitRename(node)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename(node);
                if (e.key === 'Escape') setRenamingId(null);
              }}
            />
          ) : (
            <span className={s.label}>{highlight(node.label, needle)}</span>
          )}

          {node.meta ? <span className={s.meta}>{node.meta}</span> : null}
        </div>
      );

      return isOpen && hasKids ? [row, ...rows(node.children!, depth + 1)] : [row];
    });

  return (
    <div ref={rootRef} className={`${s.root} ${className}`.trim()}>
      {(searchable || hasFacets) && (
        <div className={s.search}>
          {searchable && (
            <input
              className={s.searchInput}
              type="search"
              data-autofocus
              aria-label={searchPlaceholder}
              placeholder={searchPlaceholder}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          )}
          {hasFacets && (
            <button
              type="button"
              className={s.filterButton}
              data-active={facetsActive ? 'true' : undefined}
              aria-label="Фильтры"
              aria-expanded={panelOpen}
              onClick={() => setPanelOpen((o) => !o)}
            >
              {filterIcon ?? DEFAULT_FILTER_ICON}
            </button>
          )}
        </div>
      )}

      {hasFacets && panelOpen && (
        <div className={s.filterPanel}>
          {((facets ?? []).some((f) => f.kind === 'toggle') || facetsActive) && (
            <div className={s.facetPills}>
              {(facets ?? []).map((f) =>
                f.kind === 'toggle' ? (
                  <button
                    key={f.id}
                    type="button"
                    className={s.facetPill}
                    data-on={facetState[f.id] === true ? 'true' : undefined}
                    onClick={() => toggleFacet(f.id)}
                  >
                    {f.icon}
                    {f.label ?? f.id}
                  </button>
                ) : null,
              )}
              {facetsActive && (
                <button type="button" className={s.facetReset} onClick={resetFacets} aria-label="Сбросить фильтры">
                  {CLOSE_ICON}
                </button>
              )}
            </div>
          )}

          {(facets ?? []).map((f) => {
            if (f.kind !== 'chips') return null;
            const sel = Array.isArray(facetState[f.id]) ? (facetState[f.id] as string[]) : [];
            return (
              <div key={f.id} className={s.facetGroup}>
                {f.label ? <div className={s.facetGroupLabel}>{f.label}</div> : null}
                <div className={s.facetPills}>
                  {f.options.map((o) => (
                    <button
                      key={`${f.id}:${o.value}`}
                      type="button"
                      className={s.facetPill}
                      data-on={sel.includes(o.value) ? 'true' : undefined}
                      onClick={() => toggleChip(f.id, o.value)}
                    >
                      {o.icon}
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}

          {(facets ?? []).map((f) => {
            if (f.kind !== 'tags') return null;
            const sel = Array.isArray(facetState[f.id]) ? (facetState[f.id] as string[]) : [];
            const draft = tagDraft[f.id] ?? '';
            const q = draft.trim().toLowerCase();
            const sugg =
              tagFocus === f.id && q
                ? (facetTagValues[f.id] ?? []).filter((t) => t.includes(q) && !sel.includes(t)).slice(0, 6)
                : [];
            return (
              <div key={f.id} className={s.tagFacet}>
                {f.label ? <div className={s.facetGroupLabel}>{f.label}</div> : null}
                {sel.length > 0 && (
                  <div className={s.tagChips}>
                    {sel.map((tag) => (
                      <span key={tag} className={s.tagChip}>
                        {tag}
                        <button type="button" className={s.tagChipRemove} onClick={() => removeFacetTag(f.id, tag)} aria-label="Убрать тег">
                          {CLOSE_ICON}
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className={s.tagInputWrap}>
                  <input
                    className={s.tagInput}
                    value={draft}
                    placeholder={f.placeholder ?? '+ тег'}
                    onChange={(e) => setTagDraft((d) => ({ ...d, [f.id]: e.target.value }))}
                    onFocus={() => setTagFocus(f.id)}
                    onKeyDown={(e) => {
                      if ((e.key === 'Enter' || e.key === ',') && draft.trim()) {
                        e.preventDefault();
                        addFacetTag(f.id, draft);
                      } else if (e.key === 'Backspace' && !draft && sel.length) {
                        const last = sel[sel.length - 1];
                        if (last) removeFacetTag(f.id, last);
                      }
                    }}
                    onBlur={() => setTimeout(() => setTagFocus((cur) => (cur === f.id ? null : cur)), 150)}
                  />
                  {sugg.length > 0 && (
                    <div className={s.suggest}>
                      {sugg.map((t) => (
                        <button key={t} type="button" className={s.suggestItem} onMouseDown={() => addFacetTag(f.id, t)}>
                          {t}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className={s.list} role="tree" aria-label={label} aria-multiselectable={multi || undefined}>
        {visible.length === 0 ? (
          <div className={s.empty}>{emptyText}</div>
        ) : (
          rows(visible, 0)
        )}
      </div>

      {menu && menuItems && (
        <TreeContextMenu
          node={menu.node}
          x={menu.x}
          y={menu.y}
          items={menuItems(menu.node, controls)}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

function TreeContextMenu({
  node,
  x,
  y,
  items,
  onClose,
}: {
  node: TreeNode;
  x: number;
  y: number;
  items: TreeMenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [openSub, setOpenSub] = useState<string | null>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  // Кламп в вьюпорт: у нижней кромки меню иначе уезжает за экран.
  const top = Math.min(y, window.innerHeight - items.length * 30 - 24);
  const left = Math.min(x, window.innerWidth - 210);

  return createPortal(
    <div ref={ref} className={s.menu} style={{ top: Math.max(8, top), left: Math.max(8, left) }}>
      {items.map((it) =>
        it.separator ? (
          <TreeDivider key={it.id} />
        ) : confirming === it.id ? (
          <div key={it.id} className={s.confirmRow}>
            <span style={{ fontSize: 12 }}>{it.confirm}</span>
            <button
              className={s.confirmButton}
              onClick={() => {
                setConfirming(null);
                it.onSelect?.(node);
                onClose();
              }}
            >
              Да
            </button>
            <button className={s.menuButton} style={{ width: 'auto' }} onClick={() => setConfirming(null)}>
              Нет
            </button>
          </div>
        ) : it.items && it.items.length > 0 ? (
          <div
            key={it.id}
            style={{ position: 'relative' }}
            onMouseEnter={() => setOpenSub(it.id)}
            onMouseLeave={() => setOpenSub((v) => (v === it.id ? null : v))}
          >
            <button className={s.menuButton} disabled={it.isDisabled}>
              {it.icon ? <span className={s.icon}>{it.icon}</span> : null}
              <span>{it.label}</span>
              <span className={s.menuShortcut}>▸</span>
            </button>
            {openSub === it.id && (
              // Подменю раскрывается внутрь того же портала: отдельный портал
              // потерял бы наведение мыши между родителем и списком.
              <div className={s.submenu}>
                {it.items.map((sub) => (
                  <button
                    key={sub.id}
                    className={s.menuButton}
                    disabled={sub.isDisabled}
                    onClick={() => {
                      sub.onSelect?.(node);
                      onClose();
                    }}
                  >
                    {sub.icon ? <span className={s.icon}>{sub.icon}</span> : null}
                    <span>{sub.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <button
            key={it.id}
            className={s.menuButton}
            data-danger={it.danger ? 'true' : undefined}
            disabled={it.isDisabled}
            onClick={() => {
              // Подтверждение живёт в самом меню: window.confirm рвёт контекст
              // работы и запрещён дизайн-системой.
              if (it.confirm) {
                setConfirming(it.id);
                return;
              }
              it.onSelect?.(node);
              onClose();
            }}
          >
            {it.icon ? <span className={s.icon}>{it.icon}</span> : null}
            <span>{it.label}</span>
            {it.shortcut ? <span className={s.menuShortcut}>{it.shortcut}</span> : null}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}

export const TreeDivider = () => <div className={s.menuDivider} />;
