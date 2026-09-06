'use client';

/**
 * AlgCategoryView — full port of packages/client-vite/src/pages/alg/AlgCategoryPage.tsx.
 *
 * Restored (2026-06-16) to parity with the Vite version:
 *   - CommunityAlgs (logged-in users add/edit/delete their own algs per case, validated on save)
 *   - Admin tooling: AdminCaseEditor + ValidationReportModal + dnd-kit reorder (admin-gated)
 *   - Formula rows stay compact here; 3D playback lives on each case detail page
 *
 * Keeps: subgroup picker (umbrella sets), second-level picker, ori switcher,
 * per-case ori cycle, subgroup collapse, sticker/setup/HTML alg rendering.
 */
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryState, useQueryStates, parseAsBoolean, parseAsInteger, parseAsStringEnum } from 'nuqs';
import Link from '@/components/AppLink';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Copy, Check, ChevronDown, ChevronRight, Shuffle, Plus, Pencil, ShieldCheck, AlertTriangle, FlipHorizontal2, HelpCircle, Pin } from 'lucide-react';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, rectSortingStrategy, verticalListSortingStrategy } from '@dnd-kit/sortable';
import {
  loadAlg, getAlgSetMeta, ALG_PUZZLES,
  type AlgCase, type AlgEntry, type AlgFile, type AlgPuzzle, type AlgSubmission, type AlgTag,
} from '@cuberoot/shared';
import { VisualCube } from '@/components/VisualCube';
import { CaseThumb } from '@/components/CaseThumb';
import CubeOrientationSelect from '@/components/CubeOrientationSelect';
import {
  cubeThumbParams,
  DEFAULT_ALG_CUBE_ORIENTATION,
  LEVEL2_PICKER_MASK,
  supportsCaseViewAngle,
  supportsCubeOrientation,
  supportsRecognitionSimplification,
  usesSvThumbStyle,
} from '@/lib/alg_thumb_plan';
import AlgCard from '@/components/AlgCard';
import CommunityAlgs from '@/components/CommunityAlgs';
import AlgNotationStyleSelect from '@/components/AlgNotationStyleSelect';
import AdminCaseEditor, { type AdminEditorState } from '@/components/AdminCaseEditor';
import type { AlgInvalidMark } from '@/components/AlgEditor';
import ValidationReportModal from '@/components/ValidationReportModal';
import SortableAlgRow from '@/components/SortableAlgRow';
import SortableCard from '@/components/SortableCard';
import AlgMirrorPanel, { hasMirror } from '@/components/AlgMirrorPanel';
import AlgViewModeToggle, { useAlgViewMode } from '@/components/AlgViewModeToggle';
import PillToggle from '@/components/PillToggle/PillToggle';
import AlgPdfButton from '@/components/AlgPdfButton';
import { algSheetFromCases } from '@/lib/alg_pdf/from_cases';
import { useCopy } from '@/hooks/useCopy';
import { stm } from '@cuberoot/shared/alg-notation';
import { listSubmissions } from '@/lib/alg_api';
import { reorderCases, reorderCaseAlgs } from '@/lib/alg_sets_api';
import { hasAdminAccess, useAuthStore } from '@/lib/auth-store';
import { scanCases } from '@/lib/alg_validation_scan';
import { caseAnchor, findCaseByHash, algCaseDetailHref, buildCaseSlugMap, caseSlugBase } from '@/lib/alg_case_link';
import { replaceHash } from '@/lib/url_hash';
import { formatScrambleForEvent } from '@cuberoot/shared/sq1-notation';
import { buildOllNameByGroup, displayAlgCaseName, primaryCaseName, displayZbllToken } from '@/lib/alg_case_display';
import { canonicalZbllSubgroupSlug } from '@/lib/alg_zbll_subgroups';
import { sortByCp } from '@/lib/alg_cp_order';
import { sortAlgItemsBySignedLabel } from '@/lib/alg_group_order';
import { CUBE_ORIENTATIONS, visualCubeSchemeForOrientation } from '@/lib/cube-orientation';
import { ALG_TAG_LABEL, ALG_TAGS, OH_TAG_LABEL } from '@/lib/alg_tags';
import {
  CASE_VIEW_ANGLES,
  caseViewAlg,
  caseViewSetup,
  displayAlg,
  oriAdjustSetup,
  shortOriName,
  type CaseViewAngle,
} from '@/lib/alg_display';
import { sanitizeAlgHtml } from '@/lib/alg_html';
import {
  ALG_NOTATION_STYLES,
  formatAlgNotation,
  type AlgNotationStyle,
} from '@/lib/alg-notation-display';
import { useDocumentTitle } from '@/hooks/useDocumentTitle';
import { useHashHighlight } from '@/hooks/useHashHighlight';
import {
  classifySq1EpParity,
  partitionSq1EpCases,
  sq1EpNumericCaseName,
  sq1EpNumericGroupName,
  sq1EpNumericLayerName,
  sq1EpTopLayerName,
  type Sq1EpParity,
} from '@/lib/sq1-ep-parity';
import { useIsMobile } from '@/hooks/useIsMobile';
import { tr } from '@/i18n/tr';
import { firstAlgorithmAverageStm } from '@/lib/alg-metrics';
import {
  SQ1_NOTATION_MODES,
  sq1NotationText,
  type Sq1NotationMode,
} from '@/lib/sq1-pbl-notation';
import BoolToggle from '@/components/BoolToggle';
import Sq1NotationSelect from '@/components/Sq1NotationSelect';
import { InfoTooltip } from '@/components/InfoTooltip/InfoTooltip';
import { hasOhAlgsForHand, OH_HANDS, ohAlgsForCase, supportsOhHands, type OhHand } from '@/lib/alg_oh_hand';
import {
  OPTIMAL_METRICS,
  availableOptimalMetrics,
  filterCasesByOptimal,
  optimalRange,
  type OptimalComparison,
  type OptimalMetric,
} from '@/lib/alg_case_optimal';
import {
  preferredAlgRef,
  preferredAlgSlot,
  sortPreferredAlgs,
  usePreferredAlgs,
} from '@/lib/alg-preferred-algs';

const RIGHT_OH_MENU_VALUE = 'oh-right' as const;
type AlgTagMenuValue = AlgTag | 'all' | typeof RIGHT_OH_MENU_VALUE;

// oriAdjustSetup / shortOriName 已提到 lib/alg_display 与 case 详情页共用(详情页原先漏了它们,见那里的注释)。

function isPuzzle(s: string): s is AlgPuzzle {
  return (ALG_PUZZLES as readonly string[]).includes(s);
}

function SvThumbImages({
  puzzle,
  set,
  caseName,
  sticker,
  alg,
  setup,
  largeSize,
  smallSize,
  simplifyRecognition = false,
  viewAngle = 'default',
  orientation = DEFAULT_ALG_CUBE_ORIENTATION,
}: {
  puzzle: AlgPuzzle;
  set: string;
  caseName?: string;
  sticker: AlgCase['sticker'];
  alg: string;
  setup?: string;
  largeSize: number;
  smallSize: number;
  simplifyRecognition?: boolean;
  viewAngle?: CaseViewAngle;
  orientation?: string;
}) {
  return (
    <>
      <CaseThumb
        puzzle={puzzle}
        set={set}
        caseName={caseName}
        sticker={sticker}
        alg={alg}
        setup={setup}
        size={largeSize}
        loading="lazy"
        simplifyRecognition={simplifyRecognition}
        viewAngle={viewAngle}
        orientation={orientation}
      />
      <VisualCube
        algorithm={caseViewAlg(alg, viewAngle)}
        setup={caseViewSetup(setup ?? '', viewAngle)}
        view="iso"
        mask="wv"
        scheme={visualCubeSchemeForOrientation(orientation)}
        size={smallSize}
        loading="lazy"
        alt=""
      />
    </>
  );
}

/**
 * 有观察训练器(`/recognize/<set>`)的 3x3 公式集 —— 入口就挂在这一套自己的页面上,
 * 而不是堆在 `/alg/3x3` 的「训练专区」里(一整排 chip 看不出各自属于哪套)。
 * 名单与 `lib/recognize-sets` 的 RECOGNIZE_SETS 对齐;这里只要 id,不 import 那份
 * 模块是为了不把 oll/pll 题库和打乱生成器拽进公式库页的 bundle。
 */
const RECOGNIZE_SETS_3X3 = new Set(['oll', 'pll', 'coll', 'ell', 'zbll', '1lll']);
const ZBLL_DIAGRAM_MODES = ['full', 'simplified', 'dual'] as const;
type ZbllDiagramMode = (typeof ZBLL_DIAGRAM_MODES)[number];

/** 打乱行。复制的是**屏幕上这一条**(含当前记号模式),不是库里的原文。 */
function SetupLine({ puzzle, setup, notationStyle, sq1NotationMode = 'compact' }: {
  puzzle: string;
  setup: string;
  notationStyle: AlgNotationStyle;
  sq1NotationMode?: Sq1NotationMode;
}) {
  const { copied, copy } = useCopy();
  const sq1Text = puzzle === 'sq1' ? sq1NotationText(setup, sq1NotationMode) : null;
  const text = sq1Text
    ? tr(sq1Text)
    : formatAlgNotation(formatScrambleForEvent(puzzle, setup), notationStyle);
  return (
    <div className="alg-case-standard">
      <Shuffle size={13} className="alg-case-icon" aria-label={tr({ zh: '打乱', en: 'Setup' })} />
      <code>{text}</code>
      <button
        type="button"
        className="alg-alg-copy-btn alg-case-setup-copy"
        onClick={() => copy(text)}
        title={tr({ zh: '复制打乱', en: 'Copy setup' })}
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
      </button>
    </div>
  );
}

function AlgRow({ entry, puzzle, invalid, mirror, ori = 0, notationStyle, viewAngle, ohHand, sq1NotationMode = 'compact', sourceKarnaukh, preferred = false, onPreferredToggle }: {
  entry: AlgEntry;
  puzzle: AlgPuzzle; invalid?: string;
  /** 有值 = 这个 set 吃镜像系统,行尾出翻转图标;`partner` 是伙伴 case 名(没建链时为 null) */
  mirror?: { partner: string | null; self: string };
  /** 这条公式在第几个视角(0=FR),镜像面板要拿它算落点 */
  ori?: number;
  notationStyle: AlgNotationStyle;
  viewAngle: CaseViewAngle;
  ohHand?: OhHand;
  sq1NotationMode?: Sq1NotationMode;
  /** PBL 的 note 是原表卡脑壳记号；其他套系的 note 仍是普通说明。 */
  sourceKarnaukh?: boolean;
  preferred?: boolean;
  onPreferredToggle?: () => void;
}) {
  const { alg, algHtml } = entry;
  const { copied, copy } = useCopy();
  const [mirrorOpen, setMirrorOpen] = useState(false);
  // 列表只负责显示 / 复制,剥掉收尾 AUF；完整公式的动画统一放到 case 详情页。
  const angledAlg = caseViewAlg(alg, viewAngle);
  const standardAlgShown = formatScrambleForEvent(puzzle, displayAlg(angledAlg));
  const algShown = formatAlgNotation(standardAlgShown, notationStyle);
  const sq1Notation = puzzle === 'sq1'
    ? sq1NotationText(displayAlg(angledAlg), sq1NotationMode, sourceKarnaukh ? entry.note : undefined)
    : null;
  const shownText = sq1Notation ? tr(sq1Notation) : algShown;
  const isKarnaukh = puzzle === 'sq1' && sq1NotationMode === 'karnaukh';
  // 步数要数**屏幕上这一条**。`entry.stm` 是入库值(含收尾 AUF),拿它当徽章就会
  // 出现「显示 10 步、徽章写 11」。
  const shownStm = useMemo(
    () => (entry.stm == null ? null : stm(displayAlg(angledAlg))),
    [entry.stm, angledAlg],
  );
  return (
    <>
      <div
        className={`alg-alg-row${invalid ? ' is-invalid' : ''}`}
        title={invalid}
      >
        {/* 就是这条过不了校验 —— 卡片红框只说「这张有问题」,不说是哪条 */}
        {invalid && <AlertTriangle size={13} className="alg-alg-invalid-icon" aria-label={invalid} />}
        {entry.tags?.map(t => {
          const label = t === 'oh' && ohHand ? OH_TAG_LABEL[ohHand]() : ALG_TAG_LABEL[t]();
          return <span key={t} className={`alg-tag alg-tag-${t}`} title={label}>{label}</span>;
        })}
        <span className={`alg-alg-text${isKarnaukh ? ' is-karnaukh' : ''}`}>
          {sq1Notation
            ? shownText
            : algHtml && viewAngle === 'default' && puzzle !== 'sq1' && notationStyle === 'standard'
            ? <span dangerouslySetInnerHTML={{ __html: sanitizeAlgHtml(algHtml) }} />
            : algShown}
          {!sourceKarnaukh && entry.note && <span className="alg-alg-note">({tr(entry.note)})</span>}
        </span>
        {!isKarnaukh && shownStm != null && <span className="alg-alg-len" title="STM">{shownStm}</span>}
        {mirror && (
          <button
            type="button"
            className={`alg-mirror-toggle${mirrorOpen ? ' is-on' : ''}`}
            aria-expanded={mirrorOpen}
            onClick={(e) => { e.stopPropagation(); setMirrorOpen(o => !o); }}
            title={tr({ zh: '镜像公式', en: 'Mirrored algs' })}
          >
            <FlipHorizontal2 size={14} />
          </button>
        )}
        {onPreferredToggle && (
          <button
            type="button"
            className="alg-alg-copy-btn"
            onClick={(e) => { e.stopPropagation(); onPreferredToggle(); }}
            title={preferred
              ? tr({ zh: '取消置顶', en: 'Unpin algorithm' })
              : tr({ zh: '置顶公式', en: 'Pin algorithm' })}
            aria-pressed={preferred}
          >
            <Pin size={14} fill={preferred ? 'currentColor' : 'none'} className="alg-alg-copy-icon" aria-hidden="true" />
          </button>
        )}
        <button
          type="button"
          className="alg-alg-copy-btn"
          onClick={(e) => { e.stopPropagation(); copy(shownText); }}
          title="copy"
        >
          {copied ? <Check size={14} /> : <Copy size={14} className="alg-alg-copy-icon" />}
        </button>
      </div>
      {mirror && mirrorOpen && (
        <AlgMirrorPanel alg={angledAlg} puzzle={puzzle} mirrorName={mirror.partner} selfName={mirror.self} ori={ori} />
      )}
    </>
  );
}


/**
 * umbrella set 的落地页(`/alg/<p>/<set>`)。
 *
 * 两级 umbrella 且顶层组不多(ZBLL 7 组 / OLLCP…:子组形如 `U/UR`)——**就地展开**:每组一行,
 * 首格是「组封面卡」(点它展开 / 收起该组),其后是二级子组卡(`UR`/`UL`…,直接链到 case 列表)。
 * 封面卡与子组卡**同一个网格、等宽等高、魔方图一样大**,省掉「先进 /zbll/u 再挑」那一跳,默认全展开。
 *
 * 顶层组很多(1LLL 40+)——就地展开会太长,退回顶层卡片网格(点进 `/set/<组>` 的二级选择页)。
 * 单级 umbrella(ZBLS / VLS:顶层组直接装 case)——没有二级可展,同样是卡片网格(直接链到 case)。
 */
function SubgroupIndex({
  puzzle, set, cases, ollByGroup, querySuffix,
}: {
  puzzle: AlgPuzzle;
  set: string;
  cases: AlgCase[];
  /** 组号 → 字母制 OLL 名。**校验过是单射才非空**(见主组件里的 ollByGroup)。 */
  ollByGroup: Map<string, string>;
  isZh: boolean;
  querySuffix?: string;
}) {
  // 顶层组 → { 代表 case, 组内总数, 二级子组(parts[1] → 代表 case + 计数) }
  const tops = useMemo(() => {
    const map = new Map<string, { sample: AlgCase; total: number; subs: Map<string, { sample: AlgCase; count: number }> }>();
    for (const c of cases) {
      const parts = (c.subgroup || '').split('/');
      const top = parts[0] || '';
      let e = map.get(top);
      if (!e) { e = { sample: c, total: 0, subs: new Map() }; map.set(top, e); }
      e.total++;
      if (parts.length >= 2 && parts[1]) {
        const se = e.subs.get(parts[1]);
        if (se) se.count++;
        else e.subs.set(parts[1], { sample: c, count: 1 });
      }
    }
    return Array.from(map.entries());
  }, [cases]);

  // 就地展开只在「两级 + 顶层组不多」时用;组太多(1LLL)就地展开会太长,退回卡片网格。
  const inlineExpand = tops.some(([, e]) => e.subs.size > 0) && tops.length <= 10;
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set()); // 默认全展开(一眼看全所有二级子组)
  const toggle = (t: string) => setCollapsed(prev => {
    const next = new Set(prev);
    if (next.has(t)) next.delete(t); else next.add(t);
    return next;
  });

  const useF2lThumb = puzzle === '3x3' && set === 'zbls';
  const useSvStyle = usesSvThumbStyle(puzzle, set);
  const pickerMask = LEVEL2_PICKER_MASK[set];
  // 窄屏这两个网格都是四列(alg.css 的 480 断点),110px 的图会撑破格子 —— 图跟着降档。
  // 只能从这里给:缩略图的宽高是 React 出的(inline style / img 属性),CSS 压不住。
  const mobile = useIsMobile(480);
  const thumbSize = mobile ? 60 : 110;
  const svLargeThumbSize = mobile ? 42 : 110;
  const svSmallThumbSize = mobile ? 19 : 48;

  // 卡片网格:单级 umbrella(直接链到 case),或组太多的两级 umbrella(链到二级选择页)。
  if (!inlineExpand) {
    return (
      <div className={`alg-subgroup-grid${useF2lThumb ? ' is-f2l-thumb' : ''}`}>
        {tops.map(([topLabel, { sample }]) => {
          const firstAlg = sample.algs.flat()[0]?.alg ?? sample.standard ?? '';
          const slug = encodeURIComponent(topLabel.toLowerCase()) || '_'; // slug 用原名(避免 "+" 进 URL)
          const dispTop = set === 'zbll' ? displayZbllToken(topLabel) : topLabel;
          const ollName = ollByGroup.get(topLabel);
          return (
            <AlgCard
              key={topLabel || '_root_'}
              href={`/alg/${puzzle}/${set}/${slug}${querySuffix ?? ''}`}
              // zbls 的顶层组分的是 F2L 对(A+ / A− …),顶层朝向留给组内的 case 分 ——
              // 组封面画上黄色只会让 A+ 那 8 张看着都一样,所以这里就画 F2L(顶层灰)。
              /* 组封面一页几十张,窄屏整页能到 10000px 以上(实测 1lll / ollcp)。懒加载在桌面
                 是 no-op(整页都落在 Chrome 的预加载阈值内),手机首屏请求实测能砍掉三到五成。 */
              thumb={useF2lThumb
                ? <VisualCube setup={sample.setup} algorithm={firstAlg} view="f2l" size={thumbSize} loading="lazy" />
                : useSvStyle
                  ? (
                    <div className="alg-case-cube is-dual">
                      <SvThumbImages
                        puzzle={puzzle}
                        set={set}
                        sticker={sample.sticker}
                        alg={firstAlg}
                        setup={sample.setup}
                        largeSize={svLargeThumbSize}
                        smallSize={svSmallThumbSize}
                      />
                    </div>
                  )
                  : <VisualCube setup={sample.setup} algorithm={firstAlg} view="oll" size={thumbSize} loading="lazy" hideGreySides />}
              title={ollName ?? (useF2lThumb ? (dispTop || tr({ zh: '其他', en: 'Other' })) : `${set.toUpperCase()} ${dispTop || tr({ zh: '其他', en: 'Other' })}`)}
              sub={ollName && set !== 'ollcp' ? `${set.toUpperCase()} ${dispTop}` : undefined}
            />
          );
        })}
      </div>
    );
  }

  // 就地展开:每组一行 —— 封面卡(点开/折叠)+ 二级子组卡,同一网格等宽等高。
  return (
    <div className="alg-l2-index">
      {tops.map(([topLabel, e]) => {
        const isCollapsed = collapsed.has(topLabel);
        const firstAlg = e.sample.algs.flat()[0]?.alg ?? e.sample.standard ?? '';
        const dispTop = set === 'zbll' ? displayZbllToken(topLabel) : topLabel;
        // 封面卡标题不必再带 set 名(页首 H1 已写 ZBLL)。1lll 组号是纯数字 → 换字母制 OLL 名。
        const ollName = ollByGroup.get(topLabel);
        const title = ollName ?? (dispTop || tr({ zh: '其他', en: 'Other' }));
        return (
          <div key={topLabel || '_root_'} className="alg-subgroup-grid alg-l2-grid">
            <AlgCard
              expand={isCollapsed ? 'closed' : 'open'}
              onClick={() => toggle(topLabel)}
              tooltip={isCollapsed ? tr({ zh: '展开', en: 'Expand' }) : tr({ zh: '收起', en: 'Collapse' })}
              thumb={<VisualCube setup={e.sample.setup} algorithm={firstAlg} view="oll" size={thumbSize} hideGreySides />}
              title={title}
            />
            {!isCollapsed && Array.from(e.subs.entries()).map(([subLabel, { sample }]) => {
              const subFirstAlg = sample.algs.flat()[0]?.alg ?? sample.standard ?? '';
              const subSlug = encodeURIComponent(subLabel.toLowerCase());
              return (
                <AlgCard
                  key={subLabel}
                  href={`/alg/${puzzle}/${set}/${subSlug}${querySuffix ?? ''}`}
                  thumb={<CaseThumb puzzle={puzzle} set={set} caseName={sample.name} sticker={sample.sticker} alg={subFirstAlg} setup={sample.setup} size={thumbSize} mask={pickerMask} loading="lazy" />}
                  title={set === 'zbll' ? displayZbllToken(subLabel) : subLabel}
                />
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

export interface AlgCategoryViewProps {
  puzzleParam: string;
  set: string;
  subgroupParam?: string;
  /** 上层(哨兵壳分流)已经加载好的整份 set,直接复用免二次拉。admin 仍会 fresh 重拉。 */
  initialData?: AlgFile;
  /** A curated view over one DB-backed set, used by learning paths such as Simple ZBLL. */
  collection?: {
    heading: { zh: string; en: string };
    intro: { zh: string; en: string };
    backHref: string;
    sourcePath: string;
    filename: string;
    include: (c: AlgCase) => boolean;
    cardsOnly?: boolean;
    simplifiedByDefault?: boolean;
  };
}

/** Large sets normally start collapsed; SQ1 cubeshape sets are learned slice-count by
 * slice-count, so their groups stay visible on first entry despite 100+ cases. */
export function collapseAlgGroupsByDefault(
  puzzle: string,
  set: string,
  caseCount: number,
  umbrella: boolean,
): boolean {
  return caseCount > 100 && !umbrella && !(puzzle === 'sq1' && ['cs', 'csp', 'obl'].includes(set));
}

/** 分类选择页没有可见 case 列表，页头仍应显示当前 set / subgroup 的完整数量。 */
export function categoryHeaderCaseCount(
  scopedCaseCount: number,
  visibleCaseCount: number,
  showSubgroupPicker: boolean,
): number {
  return showSubgroupPicker ? scopedCaseCount : visibleCaseCount;
}

export default function AlgCategoryView({ puzzleParam, set, subgroupParam, initialData, collection }: AlgCategoryViewProps) {
  const { i18n } = useTranslation();
  const isZh = i18n.language.startsWith('zh');
  const narrow = useIsMobile(480);
  const validPuzzle = isPuzzle(puzzleParam);
  const isSq1Ep = puzzleParam === 'sq1' && set === 'ep';
  const isSq1Pbl = puzzleParam === 'sq1' && set === 'pbl';
  const meta = validPuzzle ? getAlgSetMeta(puzzleParam, set) : undefined;
  const setHeading = collection ? tr(collection.heading) : meta?.short ?? (meta ? tr(meta) : set);
  const algSetTitle = (() => {
    const fallback = tr({ zh: '公式库', en: 'Algorithms'
    });
    if (!puzzleParam || !set) return fallback;
    return `${puzzleParam} · ${setHeading}`;
  })();
  // Curated child routes own their server metadata; do not overwrite it after hydration.
  useDocumentTitle(algSetTitle, algSetTitle, !collection);
  const [data, setData] = useState<AlgFile | null>(initialData ?? null);
  const preferredSnapshots = usePreferredAlgs(state => state.snapshots);
  const loadPreferred = usePreferredAlgs(state => state.load);
  const setPreferred = usePreferredAlgs(state => state.setPreferred);
  const [error, setError] = useState<string | null>(null);
  const [activeOri, setActiveOri] = useState(0);
  const [sq1EpNumericNames, setSq1EpNumericNames] = useState(false);
  const [sq1EpHasParity, setSq1EpHasParity] = useState(false);
  const [caseOri, setCaseOri] = useState<Record<string, number>>({});
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [submissions, setSubmissions] = useState<AlgSubmission[]>([]);
  const user = useAuthStore(s => s.user);
  const isAdmin = hasAdminAccess(user);
  const [editorState, setEditorState] = useState<AdminEditorState | null>(null);
  const [validationOpen, setValidationOpen] = useState(false);
  const [validationRefreshKey, setValidationRefreshKey] = useState(0);
  const [flashId, setFlashId] = useState<number | null>(null);
  /** 点中的那张卡(黄框)。它同时是 URL 片段的来源 —— 复制地址栏就能把这张卡发给别人。 */
  const [selectedId, setSelectedId] = useState<number | null>(null);
  /**
   * 校验不过的**公式**:`${caseId}:${oriIdx}:${algIdx}` → 原因。仅管理员扫描和查看，
   * 普通访客不暴露内部数据校验状态。
   */
  const [invalidAlgs, setInvalidAlgs] = useState<Map<string, string>>(new Map());
  const invalidIds = useMemo(() => {
    const s = new Set<number>();
    if (!isAdmin) return s;
    for (const k of invalidAlgs.keys()) s.add(Number(k.split(':', 1)[0]));
    return s;
  }, [invalidAlgs, isAdmin]);
  /** 某个 case 的坏行,拆回 (oi, ai) 交给编辑器。挂载那刻编辑器行号 == algs 下标。 */
  const invalidMarksOf = useCallback((caseId: number): AlgInvalidMark[] => {
    const out: AlgInvalidMark[] = [];
    for (const [k, reason] of invalidAlgs) {
      const [cid, oi, ai] = k.split(':').map(Number);
      if (cid === caseId) out.push({ oi, ai, reason });
    }
    return out;
  }, [invalidAlgs]);
  /** 这个 case 的红标全撤。保存成功 ⟹ 它每条公式都刚过了校验,旧结论不作数了。 */
  const clearInvalidFor = useCallback((caseId: number) => {
    setInvalidAlgs(prev => {
      const next = new Map(prev);
      for (const k of prev.keys()) if (Number(k.split(':', 1)[0]) === caseId) next.delete(k);
      return next.size === prev.size ? prev : next;
    });
  }, []);
  // 筛选 → replace(不往历史里塞;AGENTS.md「URL 状态」)
  const [{ tag: tagFilter, hand: ohHand }, setTagParams] = useQueryStates(
    {
      tag: parseAsStringEnum<AlgTag | 'all'>(['all', ...ALG_TAGS]).withDefault('all'),
      hand: parseAsStringEnum<OhHand>([...OH_HANDS]).withDefault('left'),
    },
    { history: 'replace', scroll: false },
  );
  const [notationStyle, setNotationStyle] = useQueryState(
    'notation',
    parseAsStringEnum<AlgNotationStyle>([...ALG_NOTATION_STYLES]).withDefault('standard'),
  );
  // 中文面转只适用于中文三阶页。英文页即使保留了 query 偏好，也始终展示标准记号。
  const displayedNotationStyle: AlgNotationStyle = isZh && puzzleParam === '3x3'
    ? notationStyle
    : 'standard';
  const [sq1BlackTop, setSq1BlackTop] = useQueryState(
    'black',
    parseAsBoolean.withDefault(true),
  );
  const [sq1NotationMode, setSq1NotationMode] = useQueryState(
    'sq1-notation',
    parseAsStringEnum<Sq1NotationMode>([...SQ1_NOTATION_MODES]).withDefault('compact'),
  );
  const [showAllCasesParam, setShowAllCasesParam] = useQueryState(
    'all',
    parseAsBoolean.withDefault(false),
  );
  const [{ simplified, diagram: zbllDiagramParam }, setDiagramParams] = useQueryStates(
    {
      simplified: parseAsBoolean.withDefault(collection?.simplifiedByDefault ?? false),
      diagram: parseAsStringEnum<ZbllDiagramMode>([...ZBLL_DIAGRAM_MODES]).withDefault('full'),
    },
    { history: 'replace', scroll: false },
  );
  const [viewAngle, setViewAngle] = useQueryState(
    'angle',
    parseAsStringEnum<CaseViewAngle>([...CASE_VIEW_ANGLES]).withDefault('default'),
  );
  const [orientation, setOrientation] = useQueryState(
    'orientation',
    parseAsStringEnum<string>(CUBE_ORIENTATIONS.map(option => option.value))
      .withDefault(DEFAULT_ALG_CUBE_ORIENTATION),
  );
  const [optimalMetric, setOptimalMetric] = useQueryState(
    'metric',
    parseAsStringEnum<OptimalMetric>([...OPTIMAL_METRICS]).withDefault('htm'),
  );
  const [optimalComparison, setOptimalComparison] = useQueryState(
    'op',
    parseAsStringEnum<OptimalComparison>(['lte', 'eq', 'gte']).withDefault('lte'),
  );
  const [optimalMoves, setOptimalMoves] = useQueryState('moves', parseAsInteger);
  const canShowAllCases = !collection && puzzleParam === '3x3' && set === 'zbll' && !subgroupParam;
  // `simplified=true` was the old ZBLL toggle URL. Keep those shared links meaningful,
  // while all new menu choices use the single `diagram` parameter atomically.
  const zbllDiagramMode: ZbllDiagramMode = canShowAllCases && simplified && zbllDiagramParam === 'full'
    ? 'simplified'
    : zbllDiagramParam;
  const recognitionSimplified = canShowAllCases ? zbllDiagramMode === 'simplified' : simplified;
  // 列表视图(`cards` 只看图 / `full` 公式内联)。语义 + localStorage key 都在
  // AlgViewModeToggle 里,`/alg` 下所有 case 列表页共用同一个偏好。
  const [view, changeView] = useAlgViewMode();
  // ZBLL 全集有 472 张卡，固定只看图；若沿用用户在子页保存的 full 偏好，会一次铺开全部公式。

  /** 这个 set 里实际出现过的标签 —— 没有就不渲染筛选器 */
  const availableTags = useMemo(() => {
    if (!data) return [];
    const seen = new Set<AlgTag>();
    for (const c of data.cases) for (const ori of c.algs) for (const a of ori) for (const t of a.tags ?? []) seen.add(t);
    return ALG_TAGS.filter(t => seen.has(t));
  }, [data]);

  // 1LLL 读 `meta.oll`;OLLCP 的数字 subgroup 交给 OLL 页同一个 displayOllName 映射。
  const ollByGroup = useMemo(
    () => buildOllNameByGroup(puzzleParam, set, data?.cases ?? []),
    [data, puzzleParam, set],
  );

  /** 标签筛选真的在生效吗(选了 `oh`、且这个 set 确实有 `oh`)—— 生效时公式列表是个子集 */
  const filtering = tagFilter !== 'all' && availableTags.includes(tagFilter);

  const canChooseOhHand = supportsOhHands(puzzleParam, set);
  const rightHandOh = canChooseOhHand && filtering && tagFilter === 'oh' && ohHand === 'right';

  /** 一个 case 在当前筛选下要显示的公式(标签筛选作用在**公式**上,不是 case 上) */
  const algsUnderFilter = (c: AlgCase, orientation: number, algs: AlgEntry[]) => {
    if (!filtering) return algs;
    if (canChooseOhHand && tagFilter === 'oh') {
      return ohAlgsForCase(c, data?.cases ?? [], orientation, ohHand);
    }
    return algs.filter(a => a.tags?.includes(tagFilter));
  };

  // dnd-kit sensors:鼠标按住超过 5px 才认作 drag,避免误触发(普通点击不被吞)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  /** 一条公式的拖动 id。真下标(未筛选)编进去,drop 的时候直接读回来。 */
  const algDragId = (caseId: number, ori: number, i: number) => `alg-${caseId}-${ori}-${i}`;

  /**
   * 一个 case 内部重排公式 —— 第一条是主推解法,顺序是有意义的。
   * 乐观更新,失败回滚(和 case 重排同一套路)。
   */
  const handleAlgDragEnd = (c: AlgCase, oriIdx: number) => (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id || c.id == null) return;
    const idxOf = (id: string | number) => Number(String(id).split('-').pop());
    const from = idxOf(active.id);
    const to = idxOf(over.id);
    const rows = c.algs[oriIdx] ?? [];
    const sane = (n: number) => Number.isInteger(n) && n >= 0 && n < rows.length;
    if (!sane(from) || !sane(to)) return;

    const before = c.algs;
    const after = c.algs.map((ori, i) => (i === oriIdx ? arrayMove(ori, from, to) : ori));
    const swap = (algs: AlgCase['algs']) =>
      setData(d => (d ? { ...d, cases: d.cases.map(x => (x.id === c.id ? { ...x, algs } : x)) } : d));

    swap(after);
    reorderCaseAlgs(puzzleParam, set, c, after).catch(err => {
      console.error('reorder algs failed', err);
      alert(`Reorder failed: ${err.message}`);
      swap(before);
    });
  };

  const handleDragEnd = (e: DragEndEvent) => {
    if (!data) return;
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const all = data.cases;
    const oldIdx = all.findIndex(c => c.id === Number(active.id));
    const newIdx = all.findIndex(c => c.id === Number(over.id));
    if (oldIdx < 0 || newIdx < 0) return;
    const reordered = arrayMove(all, oldIdx, newIdx);
    setData({ ...data, cases: reordered });
    const ids = reordered.map(c => c.id).filter((x): x is number => typeof x === 'number');
    reorderCases(puzzleParam, set, ids).catch(err => {
      console.error('reorder failed', err);
      alert(`Reorder failed: ${err.message}`);
      setData(d => d ? { ...d, cases: all } : d);
    });
  };

  useEffect(() => {
    if (!validPuzzle || !meta) return;
    listSubmissions(puzzleParam, set)
      .then(setSubmissions)
      .catch(e => { console.warn('[alg] failed to load submissions', e); setSubmissions([]); });
  }, [puzzleParam, set, validPuzzle, meta]);

  const submissionsByCase = useMemo(() => {
    const map = new Map<string, AlgSubmission[]>();
    for (const s of submissions) {
      const arr = map.get(s.caseName) ?? [];
      arr.push(s);
      map.set(s.caseName, arr);
    }
    return map;
  }, [submissions]);

  useEffect(() => {
    if (!validPuzzle || !meta) { setError('unknown set'); setData(null); return; }
    setError(null);
    // >100 个 case 的非 umbrella set 默认全折(zbll/1lll 走子组页不折)。SQ1
    // cubeshape 是按 slice 数逐组浏览的例外,169 个 case 仍默认全展开。
    const applyCollapse = (d: AlgFile) => {
      if (collapseAlgGroupsByDefault(puzzleParam, set, d.cases.length, !!meta.umbrella)) {
        const groups = new Set<string>();
        for (const c of d.cases) groups.add(c.subgroup || '');
        setCollapsedGroups(groups);
      } else {
        setCollapsedGroups(new Set());
      }
    };
    // 哨兵壳分流已经把整份 set 拉好传下来(initialData):非 admin 直接复用,免二次 fetch。
    if (initialData && !isAdmin) { setData(initialData); applyCollapse(initialData); return; }
    setData(null);
    // admin 必须绕开那 1 小时的 Cache-Control。他刚删掉的那条公式,DB 里确实没了,
    // 但浏览器缓存里那份旧响应还在 —— 而 Ctrl+Shift+R 只绕文档和子资源的缓存,
    // **绕不过页面加载后 JS 自己发的 fetch()**,那一发照样命中旧响应。结果就是:
    // 保存成功、页面也对,一强刷,删掉的公式原地复活。fresh 就是为这个留的口子。
    loadAlg(puzzleParam, set, { fresh: isAdmin }).then(d => {
      setData(d);
      applyCollapse(d);
    }).catch(e => setError(String(e)));
  }, [puzzleParam, set, validPuzzle, meta, isAdmin, initialData]);

  useEffect(() => {
    if (!data || !validPuzzle) return;
    const sourceSets = new Set(data.cases.map(c => c.srcSet ?? set));
    for (const sourceSet of sourceSets) {
      loadPreferred(puzzleParam as AlgPuzzle, sourceSet);
    }
  }, [data, loadPreferred, puzzleParam, set, validPuzzle]);

  /** 管理员进入 set 时自动扫。case 改完(data 变 / validationRefreshKey)重扫,红标跟着消。 */
  useEffect(() => {
    if (!isAdmin || !data || !validPuzzle) { setInvalidAlgs(new Map()); return; }
    let cancelled = false;
    scanCases(puzzleParam, set, data.cases, { shouldCancel: () => cancelled })
      .then(fails => {
        if (cancelled) return;
        const m = new Map<string, string>();
        for (const f of fails) {
          if (f.caseObj.id == null) continue;
          m.set(`${f.caseObj.id}:${f.oriIdx}:${f.algIdx}`, f.reason);
        }
        setInvalidAlgs(m);
      })
      .catch(e => console.warn('[alg] validation scan failed', e));
    return () => { cancelled = true; };
  }, [data, puzzleParam, set, validPuzzle, validationRefreshKey, isAdmin]);

  /**
   * `#<case 名>` 锚点:分享出去的链接、元数据弹窗的「在列表中打开」、个人页的校验汇总都落这儿
   * (目标多半在别的组)。落地后:选中它(黄框)+ 滚过去 + 闪一下 —— 一组七十来个 case,
   * 不指出来等于没跳。(锚点不是页内状态,是 URL 片段,和 nuqs 那条约定不冲突。)
   *
   * 目标卡在**折叠的组**里(>100 个 case 的 set 默认全折)⟹ 先把那组展开,否则
   * `getElementById` 拿到 null,跳转静默失败。
   */
  // `#<case 名>` 锚点(分享链接 / 元数据弹窗「在列表中打开」/ 个人页校验汇总都落这儿,目标多半
  // 在别的、可能还折叠着的组):选中它(黄框)+ 滚过去 + 闪一下。走共享 useHashHighlight ——
  // reveal 负责选中并展开目标所在折叠组(展开后返回 false,collapsedGroups 进 deps 触发重试);
  // 闪一下用 flashId(React state,免得卡片重渲染把命令式 class 冲掉),故不传 highlightClass。
  const { setHash } = useHashHighlight({
    block: 'center',
    linger: 1800, // 闪一下语义(同一锚点不重放);实际的闪由下面 onScroll→flashId 渲染
    deps: [data, collapsedGroups, puzzleParam, set, subgroupParam, sq1EpHasParity],
    resolve: (h) => {
      const c = findCaseByHash(data?.cases ?? [], h, puzzleParam, set);
      return c?.id != null ? document.getElementById(`case-${c.id}`) : null;
    },
    reveal: (h) => {
      const c = findCaseByHash(data?.cases ?? [], h, puzzleParam, set);
      if (c?.id == null) return;
      setSelectedId(c.id);
      const parity = isSq1Ep ? classifySq1EpParity(c.name) ?? 'unclassified' : null;
      if (parity === 'parity' && !sq1EpHasParity) {
        setSq1EpHasParity(true);
        return false;
      }
      if (parity === 'no-parity' && sq1EpHasParity) {
        setSq1EpHasParity(false);
        return false;
      }
      const g = parity ? `${parity}:${c.subgroup || ''}` : c.subgroup || '';
      if (collapsedGroups.has(g)) {
        setCollapsedGroups(prev => { const next = new Set(prev); next.delete(g); return next; });
        return false; // 组刚展开,卡还没挂 → 等 collapsedGroups 变化后重试
      }
    },
    onScroll: (el) => {
      const id = Number(el.id.slice('case-'.length));
      setFlashId(id);
      window.setTimeout(() => setFlashId(cur => (cur === id ? null : cur)), 1800);
    },
  });

  // 点卡片现在是**跳到该 case 的独立页**(卡上的 <a class="alg-case-cardlink"> 覆盖层),不再是
  // 选中 + 写 hash。`selectedId` 仅由下面的 hash hook(从详情页返回带 #name 落地时)设置,用来高亮。

  const rawSubgroupSlug = subgroupParam ? decodeURIComponent(subgroupParam).toLowerCase() : null;
  // 旧数字制子组 slug(u1 / pi 1 / as1 …)→ 新方向制(ur / pif / asf …),老链接不失效(migration 0081)
  const subgroupSlug = canonicalZbllSubgroupSlug(set, rawSubgroupSlug);
  const slugLevel: 'top' | 'sub' | null = useMemo(() => {
    if (!subgroupSlug || !data) return null;
    for (const c of data.cases) {
      const parts = (c.subgroup || '').toLowerCase().split('/');
      if (parts[0] === subgroupSlug) return 'top';
      if (parts[1] === subgroupSlug) return 'sub';
    }
    return null;
  }, [data, subgroupSlug]);

  const subParentSlug = useMemo(() => {
    if (!data || slugLevel !== 'sub' || !subgroupSlug) return null;
    for (const c of data.cases) {
      const parts = (c.subgroup || '').toLowerCase().split('/');
      if (parts[1] === subgroupSlug) return parts[0];
    }
    return null;
  }, [data, slugLevel, subgroupSlug]);
  const timeAttackScope = slugLevel === 'sub' && subParentSlug && subgroupSlug
    ? `${subParentSlug}/${subgroupSlug}`
    : subgroupSlug;

  /**
   * 展示用的排序:ZBLL / COLL 把「角块已成型」(U)和「对角换」(D)提到所在组的最前。
   * 只动这一份 —— `data.cases` 保持库里的原顺序,admin 拖动重排写回的还是它。
   */
  const orderedCases = useMemo(() => {
    const ordered = sortAlgItemsBySignedLabel(
      sortByCp(set, data?.cases ?? []),
      c => primaryCaseName(puzzleParam, set, c),
    );
    return collection ? ordered.filter(collection.include) : ordered;
  }, [collection, data, puzzleParam, set]);

  const scopedCases = useMemo(() => {
    if (!subgroupSlug) return orderedCases;
    return orderedCases.filter(c => {
      const parts = (c.subgroup || '').toLowerCase().split('/');
      if (slugLevel === 'top') return parts[0] === subgroupSlug;
      if (slugLevel === 'sub') return parts[1] === subgroupSlug;
      return false;
    });
  }, [orderedCases, subgroupSlug, slugLevel]);

  const averageFirstAlgorithmStm = useMemo(
    () => isPuzzle(puzzleParam) ? firstAlgorithmAverageStm(puzzleParam, scopedCases) : null,
    [puzzleParam, scopedCases],
  );

  const availableMetrics = useMemo(() => availableOptimalMetrics(scopedCases), [scopedCases]);
  const resolvedOptimalMetric = availableMetrics.includes(optimalMetric)
    ? optimalMetric
    : availableMetrics[0] ?? optimalMetric;
  const selectedOptimalRange = useMemo(
    () => availableMetrics.length > 0 ? optimalRange(scopedCases, resolvedOptimalMetric) : null,
    [availableMetrics.length, resolvedOptimalMetric, scopedCases],
  );
  useEffect(() => {
    if (availableMetrics.length > 0 && resolvedOptimalMetric !== optimalMetric) {
      void setOptimalMetric(resolvedOptimalMetric);
    }
  }, [availableMetrics.length, optimalMetric, resolvedOptimalMetric, setOptimalMetric]);
  useEffect(() => {
    if (optimalMoves === null || !selectedOptimalRange) return;
    const clamped = Math.max(selectedOptimalRange.min, Math.min(selectedOptimalRange.max, optimalMoves));
    if (clamped !== optimalMoves) void setOptimalMoves(clamped);
  }, [optimalMoves, selectedOptimalRange, setOptimalMoves]);

  const optimalFilterActive = !collection
    && optimalMoves !== null
    && availableMetrics.length > 0
    && selectedOptimalRange !== null;
  const showAllCases = canShowAllCases
    && (showAllCasesParam || optimalFilterActive || simplified || zbllDiagramMode !== 'full');
  const effectiveView = showAllCases || collection?.cardsOnly ? 'cards' : view;
  const canSimplifyRecognition = useMemo(() => {
    if (puzzleParam !== '3x3') return false;
    const sample = scopedCases[0];
    if (!sample) return false;
    return supportsRecognitionSimplification(cubeThumbParams(puzzleParam, set, sample.sticker));
  }, [puzzleParam, scopedCases, set]);
  const canChooseViewAngle = useMemo(() => {
    const sample = scopedCases[0];
    if (!sample || !isPuzzle(puzzleParam)) return false;
    return supportsCaseViewAngle(cubeThumbParams(puzzleParam, set, sample.sticker));
  }, [puzzleParam, scopedCases, set]);
  const canChooseOrientation = useMemo(() => {
    if (!isPuzzle(puzzleParam) || scopedCases.length === 0) return false;
    return scopedCases.every(c => supportsCubeOrientation(
      puzzleParam,
      cubeThumbParams(puzzleParam, set, c.sticker),
    ));
  }, [puzzleParam, scopedCases, set]);
  // OLL 的总览和分类页都是 case 选择器；角度只留在 /oll/<case> 详情页。
  const canChooseViewAngleHere = canChooseViewAngle && set !== 'oll';
  const effectiveViewAngle: CaseViewAngle = canChooseViewAngleHere ? viewAngle : 'default';
  const effectiveOrientation = canChooseOrientation ? orientation : DEFAULT_ALG_CUBE_ORIENTATION;
  const useSvDualThumb = usesSvThumbStyle(puzzleParam, set);
  const useZbllDualThumb = canShowAllCases && zbllDiagramMode === 'dual';
  const dualLargeThumbSize = effectiveView === 'cards' ? (narrow ? 84 : 96) : 108;
  const dualSmallThumbSize = effectiveView === 'cards' ? (narrow ? 38 : 42) : 48;

  const visibleCases = useMemo(() => {
    if (!data) return [];
    const optimallyFiltered = filterCasesByOptimal(
      scopedCases,
      optimalFilterActive
        ? { metric: resolvedOptimalMetric, comparison: optimalComparison, moves: optimalMoves }
        : null,
    );
    // 选了标签就只留「至少有一条带该标签的公式」的 case —— 否则筛出来一堆空卡片。
    // ⚠ 这个 set 压根没有该标签(书签 / 后退带过来的 `?tag=oh` 落到 f2l 上)⟹ 当没筛 ——
    //    否则页面空空如也,而下拉根本不渲染,用户没有任何控件能把它改回来。
    if (effectiveView === 'cards' || tagFilter === 'all' || !availableTags.includes(tagFilter)) return optimallyFiltered;
    if (canChooseOhHand && tagFilter === 'oh') {
      return optimallyFiltered.filter(c => hasOhAlgsForHand(c, data.cases, ohHand));
    }
    return optimallyFiltered.filter(c => c.algs.some(ori => ori.some(a => a.tags?.includes(tagFilter))));
  }, [data, scopedCases, optimalFilterActive, resolvedOptimalMetric, optimalComparison, optimalMoves, effectiveView, tagFilter, availableTags, canChooseOhHand, ohHand]);

  const grouped = useMemo(() => {
    const buildGroups = (
      cases: typeof visibleCases,
      section: Sq1EpParity | 'unclassified' | null,
      groupByTopLayer = false,
    ) => {
      const map = new Map<string, typeof visibleCases>();
      for (const c of cases) {
        const subgroup = groupByTopLayer ? (sq1EpTopLayerName(c.name) ?? '') : (c.subgroup || '');
        const arr = map.get(subgroup) ?? [];
        arr.push(c);
        map.set(subgroup, arr);
      }
      return Array.from(map.entries()).map(([subgroup, subgroupCases], index) => ({
        key: section ? `${section}:${subgroup}` : subgroup || '_root_',
        subgroup,
        cases: subgroupCases,
        paritySection: section,
        startsParitySection: section !== null && index === 0,
        sectionCaseCount: cases.length,
      }));
    };

    if (!isSq1Ep) return buildGroups(visibleCases, null);

    const { noParity, parity, unclassified } = partitionSq1EpCases(visibleCases);
    return [
      ...buildGroups(
        sq1EpHasParity ? parity : noParity,
        sq1EpHasParity ? 'parity' : 'no-parity',
        true,
      ),
      ...buildGroups(unclassified, 'unclassified', true),
    ];
  }, [isSq1Ep, sq1EpHasParity, visibleCases]);

  /**
   * 公式行尾那个镜像入口(issue #40 T5 的 U1)。三份镜像是纯重写,**不依赖建链**,
   * 所以只要 set 在名单里就出;`mirror_case_id` 落库之后才多标出伙伴的名字。
   * 伙伴要在**全量** case 里找 —— 它可能正好被标签筛掉或不在当前子组。
   */
  const mirrorFor = useCallback((c: AlgCase) => {
    if (!hasMirror(puzzleParam, set)) return undefined;
    const self = primaryCaseName(puzzleParam, set, c);
    const id = c.mirrorCaseId;
    if (id == null) return { partner: null, self };
    if (id === c.id) return { partner: self, self };
    const p = data?.cases.find(x => x.id === id);
    return { partner: p ? primaryCaseName(puzzleParam, set, p) : null, self };
  }, [data, puzzleParam, set]);

  /** 整个 set 的 case → 唯一短链 slug(点卡片跳转用)。落地解析用同一份算法,见 alg_case_link。 */
  const slugMap = useMemo(() => (data ? buildCaseSlugMap(data.cases, set) : null), [data, set]);
  const caseDetailHref = useCallback(
    (c: AlgCase, edit = false) => {
      const detailHref = algCaseDetailHref(puzzleParam, set, (c.id != null && slugMap?.byId.get(c.id)) || caseSlugBase(set, c));
      const href = edit ? `${detailHref}/edit` : detailHref;
      const query = new URLSearchParams();
      if (puzzleParam === 'sq1' && !sq1BlackTop) query.set('black', 'false');
      if (puzzleParam === 'sq1' && sq1NotationMode !== 'compact') query.set('sq1-notation', sq1NotationMode);
      if (effectiveViewAngle !== 'default') query.set('angle', effectiveViewAngle);
      if (effectiveOrientation !== DEFAULT_ALG_CUBE_ORIENTATION) query.set('orientation', effectiveOrientation);
      return query.size > 0 ? `${href}?${query}` : href;
    },
    [effectiveOrientation, effectiveViewAngle, sq1NotationMode, slugMap, puzzleParam, set, sq1BlackTop],
  );

  if (!validPuzzle || !meta) {
    return <div className="alg-root"><div className="alg-empty">Unknown set: {puzzleParam}/{set}</div></div>;
  }

  const showSubgroupPicker = !collection && !!meta.umbrella && !subgroupParam && !showAllCases;
  const headerCaseCount = categoryHeaderCaseCount(
    scopedCases.length,
    visibleCases.length,
    showSubgroupPicker,
  );

  const subSubgroups = useMemo(() => {
    if (!meta.umbrella || slugLevel !== 'top') return [];
    const map = new Map<string, { sample: AlgCase; count: number }>();
    for (const c of visibleCases) {
      const parts = (c.subgroup || '').split('/');
      if (parts.length < 2) continue;
      const sub = parts[1];
      const e = map.get(sub);
      if (e) e.count++;
      else map.set(sub, { sample: c, count: 1 });
    }
    return Array.from(map.entries());
  }, [visibleCases, slugLevel, meta.umbrella]);
  const showSubSubgroupPicker = subSubgroups.length > 1;
  const canChooseOrientationHere = canChooseOrientation && !showSubgroupPicker && !showSubSubgroupPicker;

  const rawBackTo = collection?.backHref ?? (slugLevel === 'sub' && subParentSlug
    ? `/alg/${puzzleParam}/${set}/${subParentSlug}`
    : subgroupParam
      ? `/alg/${puzzleParam}/${set}`
      : `/alg/${puzzleParam}`);
  const sq1Query = new URLSearchParams();
  if (puzzleParam === 'sq1' && !sq1BlackTop) sq1Query.set('black', 'false');
  if (puzzleParam === 'sq1' && sq1NotationMode !== 'compact') sq1Query.set('sq1-notation', sq1NotationMode);
  const sq1QuerySuffix = sq1Query.size > 0 ? `?${sq1Query}` : '';
  const backTo = `${rawBackTo}${sq1QuerySuffix}`;

  const dispToken = (slug: string) => {
    const oll = ollByGroup.get(slug.toUpperCase()) ?? ollByGroup.get(slug);
    if (oll) return oll;
    return set === 'zbll' ? displayZbllToken(slug) : slug.toUpperCase();
  };
  const subgroupDisplay = (
    slugLevel === 'sub' && subParentSlug && subgroupSlug
      ? `${dispToken(subParentSlug)} · ${dispToken(subgroupSlug)}`
      : subgroupSlug
        ? dispToken(subgroupSlug)
        : ''
  );

  /**
   * 「下载 PDF」要印的那份表。**所见即所印**:当前视角(y 切换)、当前标签筛选、
   * 当前子组都跟着走。只有还没挑过组的那张落地页(`/alg/3x3/zbll`)才印整套 ——
   * 挑过组之后即使停在二级选择页(`/zbll/u`),要的也是这一组,不是整个 ZBLL。
   */
  const buildPdfSheet = () => {
    const listing = !showSubgroupPicker && !showSubSubgroupPicker;
    const pdfCases = listing || subgroupSlug ? visibleCases : orderedCases;
    const orderedPdfCases = isSq1Ep
      ? (() => {
          const sections = partitionSq1EpCases(pdfCases);
          return [...sections.noParity, ...sections.parity, ...sections.unclassified];
        })()
      : pdfCases;
    const title = collection
      ? `${puzzleParam} ${tr(collection.heading)}`
      : `${puzzleParam} ${tr(meta)}${subgroupDisplay ? ` ${subgroupDisplay}` : ''}`;
    return algSheetFromCases({
      puzzle: puzzleParam as AlgPuzzle,
      set,
      cases: orderedPdfCases,
      title,
      sourcePath: collection?.sourcePath ?? `/alg/${puzzleParam}/${set}${subgroupSlug ? `/${subgroupSlug}` : ''}`,
      filename: collection?.filename ?? `${puzzleParam}-${set}${subgroupSlug ? `-${subgroupSlug}` : ''}`,
      oriOf: listing ? (c => caseOri[c.name] ?? activeOri) : undefined,
      algFilter: listing && filtering && !rightHandOh ? (a => !!a.tags?.includes(tagFilter)) : undefined,
      algsFor: listing && rightHandOh
        ? ((c, orientation) => ohAlgsForCase(c, data?.cases ?? [], orientation, 'right'))
        : undefined,
      // 组标题印展示名:库里的 `AS/ASD` 在页面上叫 `S-D`,打印表不该露出 DB 里那一串
      groupLabel: (sub) => (isSq1Ep && sq1EpNumericNames ? sq1EpNumericGroupName(sub) : null)
        ?? ollByGroup.get(sub)
        ?? (set === 'zbll' ? displayZbllToken(sub.split('/').pop() ?? sub) : sub),
      sectionOf: isSq1Ep
        ? (c => classifySq1EpParity(c.name) === 'no-parity'
          ? tr({ zh: '无特', en: 'No parity' })
          : classifySq1EpParity(c.name) === 'parity'
            ? tr({ zh: '有特', en: 'Parity' })
            : undefined)
        : undefined,
      caseLabel: isSq1Ep && sq1EpNumericNames
        ? (c => sq1EpNumericCaseName(c.name) ?? primaryCaseName(puzzleParam, set, c))
        : undefined,
      // ZBLL 一页一类:每个子组 12 个 case 正好是一张练习表,翻到哪页就练哪一类
      groupPerPage: set === 'zbll',
      sq1BlackTop,
      simplifyRecognition: recognitionSimplified,
      viewAngle: effectiveViewAngle,
      orientation: effectiveOrientation,
    });
  };

  const toggleGroup = (g: string) => setCollapsedGroups(prev => {
    const next = new Set(prev);
    if (next.has(g)) next.delete(g); else next.add(g);
    return next;
  });

  return (
    <div className="alg-root">
      <div className="alg-cat-header">
        <Link href={backTo} className="alg-back">
          <ArrowLeft size={14} /> {tr({ zh: '返回', en: 'Back' })}
        </Link>
        <h1 className="alg-cat-title">
          <span className="alg-cat-puzzle">{puzzleParam}</span>
          {' '}
          {setHeading}
          {subgroupDisplay && <span className="alg-cat-subgroup"> {subgroupDisplay}</span>}
        </h1>
        {(collection || meta.short) && (
          <p className="alg-cat-intro">{collection ? tr(collection.intro) : tr(meta.intro ?? meta)}</p>
        )}
        {data && (
          <div className="alg-cat-metrics">
            <span className="alg-cat-metric">
              {headerCaseCount}{tr({ zh: '个', en: ' cases' })}
            </span>
            {averageFirstAlgorithmStm != null && (
              <span className="alg-cat-metric">{averageFirstAlgorithmStm.toFixed(1)} STM</span>
            )}
          </div>
        )}
        {data && canShowAllCases && (
          <BoolToggle
            value={showAllCases}
            onChange={(value) => {
              void setShowAllCasesParam(value);
              if (!value) {
                void setOptimalMoves(null);
                void setDiagramParams({ simplified: null, diagram: null });
              }
            }}
            label={tr({ zh: '显示全部情况', en: 'Show all cases' })}
            className="alg-show-all-toggle"
          />
        )}
        {data && canShowAllCases && (
          <select
            className="alg-header-select"
            value={zbllDiagramMode}
            onChange={(event) => {
              const diagram = event.target.value as ZbllDiagramMode;
              void setDiagramParams({
                simplified: null,
                diagram: diagram === 'full' ? null : diagram,
              });
            }}
            aria-label={tr({ zh: '图片显示', en: 'Diagram display' })}
          >
            <option value="full">{tr({ zh: '完整', en: 'Full' })}</option>
            <option value="simplified">{tr({ zh: '简化', en: 'Simplified' })}</option>
            <option value="dual">{tr({ zh: '双图', en: 'Dual' })}</option>
          </select>
        )}
        {data && !canShowAllCases && canSimplifyRecognition && !showSubgroupPicker && (
          <BoolToggle
            value={simplified}
            onChange={value => setDiagramParams({ simplified: value })}
            label={tr({ zh: '简化图', en: 'Simplified diagrams' })}
            className="alg-show-all-toggle"
          />
        )}
        {data && canChooseViewAngleHere && !showSubgroupPicker && !showSubSubgroupPicker && (
          <label className="alg-view-angle">
            <span>{tr({ zh: '角度', en: 'Angle' })}</span>
            <select
              className="alg-header-select"
              value={effectiveViewAngle}
              onChange={event => setViewAngle(event.target.value as CaseViewAngle)}
              aria-label={tr({ zh: '角度', en: 'Angle' })}
            >
              <option value="default">{tr({ zh: '默认', en: 'Default' })}</option>
              <option value="u">U</option>
              <option value="u2">U2</option>
              <option value="up">U&apos;</option>
            </select>
          </label>
        )}
        {data && canChooseOrientationHere && (
          <label className="alg-view-angle">
            <span>{tr({ zh: '朝向', en: 'Holding' })}</span>
            <CubeOrientationSelect
              className="alg-header-select"
              value={effectiveOrientation}
              onChange={value => void setOrientation(value)}
              ariaLabel={tr({ zh: '魔方朝向', en: 'Cube holding orientation' })}
            />
          </label>
        )}
        {data && !collection && availableMetrics.length > 0 && (!showSubgroupPicker || canShowAllCases) && selectedOptimalRange && (
          <div className="alg-optimal-filter" role="group" aria-label={tr({ zh: '按最优步数筛选', en: 'Filter by optimal move count' })}>
            <span className="alg-optimal-filter-label">{tr({ zh: '最优', en: 'Optimal' })}</span>
            <select
              className="alg-header-select"
              value={resolvedOptimalMetric}
              onChange={e => setOptimalMetric(e.target.value as OptimalMetric)}
              aria-label={tr({ zh: '步数指标', en: 'Move metric' })}
            >
              {availableMetrics.map(metric => <option key={metric} value={metric}>{metric.toUpperCase()}</option>)}
            </select>
            <select
              className="alg-header-select alg-optimal-comparison"
              value={optimalComparison}
              onChange={e => setOptimalComparison(e.target.value as OptimalComparison)}
              aria-label={tr({ zh: '比较方式', en: 'Comparison' })}
            >
              <option value="lte">≤</option>
              <option value="eq">=</option>
              <option value="gte">≥</option>
            </select>
            <select
              className="alg-header-select"
              value={optimalMoves ?? ''}
              onChange={e => setOptimalMoves(e.target.value ? Number(e.target.value) : null)}
              aria-label={tr({ zh: '最优步数', en: 'Optimal move count' })}
            >
              <option value="">{tr({ zh: '步数', en: 'Moves' })}</option>
              {Array.from(
                { length: selectedOptimalRange.max - selectedOptimalRange.min + 1 },
                (_, i) => selectedOptimalRange.min + i,
              ).map(moves => <option key={moves} value={moves}>{moves}</option>)}
            </select>
            {optimalFilterActive && (
              <button type="button" className="alg-filter-clear" onClick={() => setOptimalMoves(null)}>
                {tr({ zh: '清除', en: 'Clear' })}
              </button>
            )}
          </div>
        )}
        {puzzleParam === 'sq1' && !isSq1Ep && (
          <BoolToggle
            value={sq1BlackTop}
            onChange={setSq1BlackTop}
            label={tr({ zh: '黑顶', en: 'Black top' })}
            className="alg-sq1-black-top-toggle"
          />
        )}
        {data && puzzleParam === 'sq1' && (
          <Sq1NotationSelect
            value={sq1NotationMode}
            onChange={value => void setSq1NotationMode(value)}
          />
        )}
        {/* 图 / 公式 视图开关(只在真列出 case 的页面;子组选择页没有卡片) */}
        {data && !showSubgroupPicker && !showSubSubgroupPicker && !showAllCases && !collection?.cardsOnly && (
          <AlgViewModeToggle value={view} onChange={changeView} className="alg-view-toggle" />
        )}
        {puzzleParam === 'fto' && (
          <Link href="/alg/fto/notation" className="alg-recog-cta" prefetch={false}>
            <HelpCircle size={15} aria-hidden="true" />
            {tr({ zh: '转动记号', en: 'Move notation' })}
          </Link>
        )}
        {!collection && !subgroupParam && puzzleParam === 'sq1' && set === 'cs' && (
          <Link href="/sq1/cs/name" className="alg-recog-cta" prefetch={false}>
            {tr({ zh: '命名', en: 'Shape names' })}
          </Link>
        )}
        {!collection && !subgroupParam && puzzleParam === 'sq1' && set === 'pbl' && (
          <>
            <Link href="/alg/sq1/karnaukh-notation" className="alg-recog-cta" prefetch={false}>
              {tr({ zh: '卡脑壳记号', en: 'Karnaukh notation' })}
            </Link>
            <Link href="/alg/sq1/pbl-finder" className="alg-recog-cta" prefetch={false}>
              {tr({ zh: '高级查找', en: 'Advanced finder' })}
            </Link>
          </>
        )}
        {isZh && data && !showSubgroupPicker && !showSubSubgroupPicker && effectiveView === 'full' && puzzleParam === '3x3' && (
          <>
            <AlgNotationStyleSelect
              value={notationStyle}
              onChange={value => void setNotationStyle(value)}
            />
            {displayedNotationStyle !== 'standard' && (
              <Link href="/notation" prefetch={false} className="alg-back">
                <HelpCircle size={15} aria-hidden="true" />
                {tr({ zh: '记号说明', en: 'Notation guide' })}
              </Link>
            )}
          </>
        )}
        {/* 标签筛选只在公式内联时有意义(只看图时没公式可筛) */}
        {data && !showSubgroupPicker && !showSubSubgroupPicker && effectiveView === 'full' && availableTags.length > 0 && (
          <>
            <select
              className="alg-header-select"
              value={tagFilter === 'oh' && ohHand === 'right' ? RIGHT_OH_MENU_VALUE : tagFilter}
              onChange={e => {
                const value = e.target.value as AlgTagMenuValue;
                if (value === RIGHT_OH_MENU_VALUE) {
                  void setTagParams({ tag: 'oh', hand: 'right' });
                  return;
                }
                void setTagParams({ tag: value, hand: 'left' });
              }}
              aria-label={tr({ zh: '按标签筛选公式', en: 'Filter algs by tag' })}
            >
              <option value="all">{tr({ zh: '全部', en: 'All' })}</option>
              {availableTags.map(t => t === 'oh' && canChooseOhHand ? (
                <Fragment key={t}>
                  <option value="oh">{OH_TAG_LABEL.left()}</option>
                  <option value={RIGHT_OH_MENU_VALUE}>{OH_TAG_LABEL.right()}</option>
                </Fragment>
              ) : (
                <option key={t} value={t}>{ALG_TAG_LABEL[t]()}</option>
              ))}
            </select>
          </>
        )}
        {/* 打印表:子组选择页(没列 case)也给 —— 那一层下载的是**整套**,
            正是「把这套公式印出来」最自然的落点 */}
        {data && data.cases.length > 0 && (
          <AlgPdfButton build={buildPdfSheet} />
        )}
        {/* set 级(含 umbrella 落地页)从全集选;subgroup 页带 ?scope= 只从该组选 */}
        {data && !collection && (
          <Link
            href={`/alg/${puzzleParam}/${set}/select${subgroupSlug ? `?scope=${encodeURIComponent(subgroupSlug)}` : ''}`}
            className="alg-train-cta"
            prefetch={false}
          >
            {tr({ zh: '训练', en: 'Train' })}
          </Link>
        )}
        {data && !collection && validPuzzle && (
          <Link
            href={`/alg/time-attack?puzzle=${puzzleParam}&set=${set}${timeAttackScope ? `&scope=${encodeURIComponent(timeAttackScope)}` : ''}`}
            className="alg-recog-cta"
            prefetch={false}
          >
            {tr({ zh: '连拧', en: 'Time Attack' })}
          </Link>
        )}
        {/* 观察训练:只认图形不还原,和上面的「训练」是同一套 case 的另一种练法,
            所以入口就在这套自己的页首(以前是 /alg/3x3 底部一排不分套的 chip)。 */}
        {!collection && puzzleParam === '3x3' && RECOGNIZE_SETS_3X3.has(set) && (
          <Link href={`/recognize/${set}`} className="alg-recog-cta" prefetch={false}>
            {tr({ zh: '观察', en: 'Recognition' })}
          </Link>
        )}
        {!collection && !subgroupParam && puzzleParam === '3x3' && set === 'zbll' && (
          <Link href="/alg/3x3/zbll/simple" className="alg-recog-cta" prefetch={false}>
            {tr({ zh: '简单', en: 'Simple' })}
          </Link>
        )}
        {!collection && !subgroupParam && puzzleParam === '3x3' && (set === 'pll' || set === 'oll') && (
          <Link href={`/recognize/${set}/guide`} className="alg-recog-cta" prefetch={false}>
            {tr({ zh: '识别指南', en: 'Recognition guide' })}
          </Link>
        )}
        {/* 新增 / 校验作用在**整个 set** 上,和这一层是不是列 case 卡片无关 ——
            子组选择页(umbrella set 首页,如 /alg/3x3/zbls)照样要有:那一层没有卡片可点,
            但「这套公式集有没有校验不过的」正是从这儿开始查的。 */}
        {!collection && isAdmin && data && (
          <>
            <button
              type="button"
              className="alg-admin-add-btn"
              onClick={() => setEditorState({ mode: 'add' })}
              title={tr({ zh: '新增 case (admin)', en: 'Add case (admin)' })}
            >
              <Plus size={14} />
            </button>
            <button
              type="button"
              className="alg-admin-add-btn"
              onClick={() => setValidationOpen(true)}
              title={tr({ zh: '校验此 set 所有公式', en: 'Validate this set' })}
            >
              <ShieldCheck size={14} /> {tr({ zh: '校验', en: 'Validate' })}
            </button>
          </>
        )}
      </div>

      {data && !showSubgroupPicker && (() => {
        const oriNames = data.cases[0]?.oriNames;
        if (!oriNames || oriNames.length <= 1) return null;
        return (
          <div className="alg-ori-tabs alg-ori-tabs-global">
            {oriNames.map((name, i) => (
              <button
                key={i}
                type="button"
                className={`alg-ori-tab${activeOri === i ? ' is-active' : ''}`}
                onClick={() => { setActiveOri(i); setCaseOri({}); }}
              >
                {shortOriName(name)}
              </button>
            ))}
          </div>
        );
      })()}

      {error && <div className="alg-empty">{error}</div>}
      {!data && !error && <div className="alg-empty">{tr({ zh: '加载中…', en: 'Loading…'
    })}</div>}

      {data && showSubgroupPicker && (
        <SubgroupIndex puzzle={puzzleParam as AlgPuzzle} set={set} cases={orderedCases} ollByGroup={ollByGroup} isZh={isZh} querySuffix={sq1QuerySuffix} />
      )}

      {data && showSubSubgroupPicker && (() => {
        const pickerMask = LEVEL2_PICKER_MASK[set];
        const thumbSize = narrow ? 60 : 110; // 同 SubgroupIndex:窄屏四列,图跟着降档
        return (
          <div className="alg-subgroup-grid">
            {subSubgroups.map(([subLabel, { sample }]) => {
              const firstAlg = sample.algs.flat()[0]?.alg ?? sample.standard ?? '';
              const sub2Slug = encodeURIComponent(subLabel.toLowerCase());
              return (
                <AlgCard
                  key={subLabel}
                  href={`/alg/${puzzleParam}/${set}/${sub2Slug}${sq1QuerySuffix}`}
                  /* 子组卡片一页几十张,窄屏下整页能到 10000px 以上(实测 1lll / ollcp)。
                     懒加载在桌面是 no-op(整页都在 Chrome 阈值内),但手机首屏请求实测能砍掉三到五成。 */
                  thumb={<CaseThumb puzzle={puzzleParam as AlgPuzzle} set={set} caseName={sample.name} sticker={sample.sticker} alg={firstAlg} setup={sample.setup} size={thumbSize} mask={pickerMask} loading="lazy" />}
                  title={set === 'zbll' ? displayZbllToken(subLabel) : subLabel}
                />
              );
            })}
          </div>
        );
      })()}

      {data && !showSubgroupPicker && !showSubSubgroupPicker && isSq1Ep && (
        <div className="alg-ep-options">
          <div className="alg-ep-toggle-row">
            <PillToggle
              value={sq1EpNumericNames}
              onChange={setSq1EpNumericNames}
              offLabel={tr({ zh: '英文命名', en: 'English names' })}
              onLabel={tr({ zh: '数字命名', en: 'Numeric names' })}
              ariaLabel={tr({ zh: '切换 SQ1 EP 命名方式', en: 'Switch SQ1 EP naming system' })}
            />
            <span className="alg-ep-parity-control">
              <BoolToggle
                value={sq1EpHasParity}
                onChange={setSq1EpHasParity}
                label={tr({ zh: '特', en: 'Parity' })}
              />
              <InfoTooltip
                icon={HelpCircle}
                iconSize={16}
                content={tr({
                  zh: '棱特：上下层棱块排列的奇偶性不同。',
                  en: 'Edge parity: the layers have different edge-permutation parity.',
                })}
              />
            </span>
            <BoolToggle
              value={sq1BlackTop}
              onChange={setSq1BlackTop}
              label={tr({ zh: '黑顶', en: 'Black top' })}
              className="alg-sq1-black-top-toggle"
            />
          </div>
        </div>
      )}

      {data && !showSubgroupPicker && !showSubSubgroupPicker && grouped.map((group) => {
        const { key, subgroup, cases, paritySection, startsParitySection, sectionCaseCount } = group;
        const collapsed = collapsedGroups.has(key);
        const showHeader = !subgroupParam && (grouped.length > 1 || subgroup !== '');
        return (
          <Fragment key={key}>
          {startsParitySection && paritySection === 'unclassified' && (
            <div className="alg-ep-parity-section">
              <h2>
                {tr({ zh: '待确认', en: 'Review needed' })}
                <span>{sectionCaseCount}</span>
              </h2>
              <p>
                {tr({ zh: '名称无法自动判定，暂不误标', en: 'Names that cannot be classified are left unmarked' })}
              </p>
            </div>
          )}
          <section className="alg-subgroup">
            {showHeader && (
              <h2
                className="alg-subgroup-title is-toggleable"
                onClick={() => toggleGroup(key)}
                role="button"
                tabIndex={0}
              >
                {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                {isSq1Ep
                  ? (sq1EpNumericNames
                    ? `${sq1EpNumericLayerName(subgroup) ?? subgroup}.*`
                    : tr({ zh: `上层 ${subgroup}`, en: `Top ${subgroup}` }))
                  : (ollByGroup.get(subgroup) ?? subgroup ?? tr({ zh: '其他', en: 'Other' }))}
                <span className="alg-subgroup-count">{cases.length}</span>
              </h2>
            )}
            {!collapsed && (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext
                  items={cases.map(c => c.id).filter((x): x is number => typeof x === 'number')}
                  strategy={rectSortingStrategy}
                >
              <div className={`alg-case-list${effectiveView === 'cards' ? ' is-cards' : ''}`}>
                {cases.map(c => {
                  const rawOri = caseOri[c.name] ?? activeOri;
                  const oriIdx = rawOri < c.algs.length ? rawOri : 0;
                  const allAlgsForOri = c.algs[oriIdx] ?? c.algs[0] ?? [];
                  const preferenceSet = c.srcSet ?? set;
                  const preferenceSlot = preferredAlgSlot(c, oriIdx);
                  const preferredRef = preferredSnapshots[`${puzzleParam}/${preferenceSet}`]?.items[preferenceSlot];
                  const displayAlgsForOri = algsUnderFilter(c, oriIdx, allAlgsForOri);
                  // 右手条目来自镜像 partner，沿用 partner 的原始优先级；当前 case 的左手置顶记录不适用。
                  const algsForOri = rightHandOh
                    ? displayAlgsForOri
                    : sortPreferredAlgs(displayAlgsForOri, preferredRef).map(row => row.entry);
                  const oriCount = c.algs.length;
                  // 缩略图始终用**未筛选**的首条 —— 筛选只该影响公式列表,不该换掉 case 的图
                  const firstAlg = allAlgsForOri[0]?.alg ?? c.standard ?? '';
                  const orientedSetup = oriAdjustSetup(c.setup, oriIdx);
                  const primaryName = primaryCaseName(puzzleParam, set, c);
                  // LS 页首已经写明 LS1–LS9；卡片只留 Hammer 1 / PBL 2 等组内名称，避免重复套名。
                  const defaultCardName = puzzleParam === '2x2' && /^ls[1-9]$/.test(set)
                    ? primaryName.replace(/^LS[1-9]\s+/, '')
                    : primaryName;
                  const cardName = isSq1Ep && sq1EpNumericNames
                    ? (sq1EpNumericCaseName(c.name) ?? defaultCardName)
                    : defaultCardName;
                  return (
                    <SortableCard key={c.id ?? c.name} id={c.id ?? 0} draggable={isAdmin && c.id != null}>
                    <article
                      className={`alg-case${flashId === c.id ? ' is-flash' : ''}${selectedId === c.id ? ' is-selected' : ''}${isAdmin && c.id != null && invalidIds.has(c.id) ? ' is-invalid' : ''}`}
                      id={c.id != null ? `case-${c.id}` : undefined}
                      title={isAdmin && c.id != null && invalidIds.has(c.id)
                        ? tr({ zh: '这个 case 有公式校验不通过', en: 'This case has failing algs' })
                        : undefined}
                    >
                      {/* 整卡跳到这张 case 的独立页(缩略图 + 名字 = 跳转区;公式/复制/社区区
                          z-index 抬到覆盖层之上,照常交互)。真 <a>,中键可新开。 */}
                      <Link
                        href={caseDetailHref(c)}
                        className="alg-case-cardlink"
                        prefetch={false}
                        aria-label={cardName}
                      />
                      {isAdmin && c.id != null && (
                        <Link
                          href={caseDetailHref(c, true)}
                          prefetch={false}
                          className="alg-admin-edit-btn alg-admin-edit-btn-corner"
                          title={tr({ zh: '编辑 case (admin)', en: 'Edit case (admin)' })}
                        >
                          <Pencil size={12} />
                        </Link>
                      )}
                      <div className="alg-case-head">
                        <div className={`alg-case-cube${useSvDualThumb || useZbllDualThumb ? ' is-dual' : ''}`}>
                          {useSvDualThumb ? (
                            <>
                              {/* SV / VLS / WV 共用 /sim 的 VLS 可见区:
                                  黄色块上的非黄色贴纸置灰；外围灰色侧环不提供识别信息，直接隐藏。
                                  小图保留立体拿方，但沿用同一遮罩。 */}
                              <SvThumbImages
                                puzzle={puzzleParam as AlgPuzzle}
                                set={set}
                                caseName={c.name}
                                sticker={c.sticker}
                                alg={firstAlg || c.setup || ''}
                                setup={orientedSetup}
                                largeSize={dualLargeThumbSize}
                                smallSize={dualSmallThumbSize}
                                simplifyRecognition={recognitionSimplified}
                                viewAngle={effectiveViewAngle}
                                orientation={effectiveOrientation}
                              />
                            </>
                          ) : useZbllDualThumb ? (
                            <>
                              <CaseThumb
                                puzzle={puzzleParam as AlgPuzzle}
                                set={set}
                                caseName={c.name}
                                sticker={c.sticker}
                                alg={firstAlg || c.setup || ''}
                                setup={orientedSetup}
                                size={dualLargeThumbSize}
                                loading="lazy"
                                simplifyRecognition
                                viewAngle={effectiveViewAngle}
                                orientation={effectiveOrientation}
                              />
                              <CaseThumb
                                puzzle={puzzleParam as AlgPuzzle}
                                set={set}
                                sticker={c.sticker}
                                alg={firstAlg || c.setup || ''}
                                setup={orientedSetup}
                                size={dualSmallThumbSize}
                                loading="lazy"
                                viewAngle={effectiveViewAngle}
                                orientation={effectiveOrientation}
                              />
                            </>
                          ) : (
                            <CaseThumb
                              puzzle={puzzleParam as AlgPuzzle}
                              set={set}
                              caseName={c.name}
                              sticker={c.sticker}
                              alg={firstAlg || c.setup || ''}
                              setup={orientedSetup}
                              /* case 网格不分页,大集一次铺满(1lll 3397 张 / zbll 472 张)。
                                 懒加载让视口外的图根本不发请求 —— 这是长网格的常规做法,
                                 也别改成 local 本地渲染:那会把几千次渲染压进主线程,比发请求更糟。 */
                              loading="lazy"
                              sq1BlackTop={sq1BlackTop}
                              simplifyRecognition={recognitionSimplified}
                              viewAngle={effectiveViewAngle}
                              orientation={effectiveOrientation}
                            />
                          )}
                        </div>
                        <div className="alg-case-info">
                          <div className="alg-case-name">
                            <span className="alg-case-letter">{cardName}</span>
                            {/* 字母制主名接管之后,站上原来那个名字(`1LLL 6 7` / `ZBLL L 34`)降为副名 —— 不丢。
                                但 PLL 的 OLLCP 名剥掉 `PLL-` 前缀后就等于站上的名字,再挂一个副名纯属重复。 */}
                            {(() => {
                              if (!c.meta?.ollcp) return null;
                              const disp = displayAlgCaseName(puzzleParam, set, c.name);
                              const primary = primaryCaseName(puzzleParam, set, c);
                              return disp.startsWith(primary) ? null : <span className="alg-case-index">{disp}</span>;
                            })()}
                            {c.number != null && <span className="alg-case-index">#{c.number}</span>}
                            {oriCount > 1 && (
                              <button
                                type="button"
                                className="alg-case-y-btn"
                                onClick={() => setCaseOri(prev => ({ ...prev, [c.name]: (oriIdx + 1) % oriCount }))}
                                title={`${shortOriName(c.oriNames?.[oriIdx] ?? '')} → ${shortOriName(c.oriNames?.[(oriIdx + 1) % oriCount] ?? '')}`}
                              >
                                y
                                <span className="alg-case-y-current">{shortOriName(c.oriNames?.[oriIdx] ?? '')}</span>
                              </button>
                            )}
                          </div>
                          {effectiveView === 'full' && c.setup && (
                            <SetupLine
                              puzzle={puzzleParam}
                              setup={caseViewSetup(oriAdjustSetup(c.setup, oriIdx), effectiveViewAngle)}
                              notationStyle={displayedNotationStyle}
                              sq1NotationMode={sq1NotationMode}
                            />
                          )}
                        </div>
                      </div>
                      {effectiveView === 'full' && (<>
                      <div className="alg-case-algs">
                        {(() => {
                          // 筛了标签就别拖:看到的是子集,拖出来的顺序对不上真实数组
                          const dragAlgs = isAdmin && c.id != null && !filtering;
                          const rows = algsForOri.map((entry, displayIdx) => {
                            // 校验结果 / 拖动 id 都按**未筛选**的下标走(标签筛选只是个视图)——
                            // 拿对象身份换回真下标
                            const trueIdx = allAlgsForOri.indexOf(entry);
                            const row = (
                              <AlgRow
                                entry={entry}
                                puzzle={puzzleParam as AlgPuzzle}
                                invalid={isAdmin && c.id != null && trueIdx >= 0 ? invalidAlgs.get(`${c.id}:${oriIdx}:${trueIdx}`) : undefined}
                                ori={oriIdx}
                                mirror={mirrorFor(c)}
                                notationStyle={displayedNotationStyle}
                                viewAngle={effectiveViewAngle}
                                ohHand={rightHandOh ? 'right' : undefined}
                                sq1NotationMode={sq1NotationMode}
                                sourceKarnaukh={isSq1Pbl}
                                preferred={!rightHandOh && preferredAlgRef(entry) === preferredRef}
                                onPreferredToggle={rightHandOh ? undefined : () => setPreferred(
                                  puzzleParam as AlgPuzzle,
                                  preferenceSet,
                                  preferenceSlot,
                                  preferredAlgRef(entry) === preferredRef ? null : preferredAlgRef(entry),
                                )}
                              />
                            );
                            const key = `${entry.altId ?? entry.alg}::${trueIdx >= 0 ? trueIdx : displayIdx}`;
                            // 不拖的时候一层壳都不加 —— AlgRow 还可能带镜像公式面板,
                            // 套个 div 会把它和列表的 gap 关系改掉
                            return dragAlgs
                              ? (
                                <SortableAlgRow key={key} id={algDragId(c.id!, oriIdx, trueIdx)} draggable>
                                  {row}
                                </SortableAlgRow>
                              )
                              : <Fragment key={key}>{row}</Fragment>;
                          });
                          if (!dragAlgs) return rows;
                          return (
                            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleAlgDragEnd(c, oriIdx)}>
                              <SortableContext
                                items={algsForOri.map(e => algDragId(c.id!, oriIdx, allAlgsForOri.indexOf(e)))}
                                strategy={verticalListSortingStrategy}
                              >
                                {rows}
                              </SortableContext>
                            </DndContext>
                          );
                        })()}
                      </div>
                      <CommunityAlgs
                        puzzle={puzzleParam}
                        setSlug={set}
                        caseName={c.name}
                        sticker={c.sticker}
                        setup={c.setup}
                        firstAlg={c.algs[0]?.[0]?.alg}
                        submissions={submissionsByCase.get(c.name) ?? []}
                        notationStyle={displayedNotationStyle}
                        viewAngle={effectiveViewAngle}
                        onPatch={(action) => {
                          setSubmissions(prev => {
                            if (action.type === 'add') return [...prev, action.submission];
                            if (action.type === 'update') return prev.map(s => s.id === action.submission.id ? action.submission : s);
                            return prev.filter(s => s.id !== action.id);
                          });
                        }}
                      />
                      </>)}
                    </article>
                    </SortableCard>
                  );
                })}
              </div>
                </SortableContext>
              </DndContext>
            )}
          </section>
          </Fragment>
        );
      })}

      {editorState && (
        <AdminCaseEditor
          puzzle={puzzleParam as AlgPuzzle}
          setSlug={set}
          state={editorState}
          initialInvalid={
            editorState.mode === 'edit' && editorState.existing.id != null
              ? invalidMarksOf(editorState.existing.id)
              : undefined
          }
          onClose={() => setEditorState(null)}
          onSaved={(action) => {
            if (!data) return;
            if (action.type === 'add') {
              setData({ ...data, cases: [...data.cases, action.created] });
            } else if (action.type === 'update') {
              setData({ ...data, cases: data.cases.map(c => c.id === action.updated.id ? action.updated : c) });
              if (action.updated.id != null) clearInvalidFor(action.updated.id);
              // 改的正是选中那张 ⟹ 片段跟着换名字,否则地址栏还挂着旧名(分享出去就是个死链)
              if (selectedId === action.updated.id) {
                const frag = caseAnchor(action.updated.name);
                replaceHash(frag);
                setHash(`#${frag}`, { markActed: true });
              }
            } else {
              setData({ ...data, cases: data.cases.filter(c => c.id !== action.id) });
              clearInvalidFor(action.id); // case 没了,它的红标也别留着
              if (selectedId === action.id) { setSelectedId(null); replaceHash(''); setHash('', { markActed: true }); }
            }
            // 校验报告打开时,case saved 后让它重跑刷新结果
            if (validationOpen) setValidationRefreshKey(k => k + 1);
          }}
        />
      )}

      {validationOpen && (
        <ValidationReportModal
          scope={{ kind: 'set', puzzle: puzzleParam as AlgPuzzle, set }}
          onClose={() => setValidationOpen(false)}
          onPickCase={(_p, _s, c) => setEditorState({ mode: 'edit', existing: c })}
          refreshKey={validationRefreshKey}
        />
      )}

    </div>
  );
}
