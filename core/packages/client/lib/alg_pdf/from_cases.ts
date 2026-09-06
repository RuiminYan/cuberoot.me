/**
 * 库里的 `AlgCase[]` → 一份可打印的公式表(`AlgPdfSheetInput`)。
 *
 * 列表页 / case 详情页 / 3BLD 换位子字典喂进来的都是同一个 `AlgCase` 结构,
 * 差别只在「用哪个视角、剥不剥收尾 AUF、出不出图」这几个开关上,所以换算只此一份。
 *
 * 与屏幕上那张卡片保持一致的几处:公式走 `displayAlg`(剥收尾 AUF)再按拼图重排记号、
 * 缩略图取**未筛选**的首条公式、setup 跟着视角旋转(`oriAdjustSetup`)。
 */
import type { AlgCase, AlgEntry, AlgPuzzle } from '@cuberoot/shared';
import { formatScrambleForEvent } from '@cuberoot/shared/sq1-notation';
import { primaryCaseName } from '@/lib/alg_case_display';
import {
  caseViewAlg,
  caseViewSetup,
  displayAlg,
  oriAdjustSetup,
  shortOriName,
  type CaseViewAngle,
} from '@/lib/alg_display';
import type { AlgPdfCase, AlgPdfSheetInput } from './sheet';

export type AlgSheetInput = Omit<AlgPdfSheetInput, 'onProgress' | 'shouldCancel'>;

/** 打印表默认每个 case 印几条公式(见 `FromCasesOptions.maxAlgs`)。 */
export const DEFAULT_MAX_ALGS = 3;

export interface FromCasesOptions {
  puzzle: AlgPuzzle;
  set: string;
  cases: AlgCase[];
  title: string;
  /** 页首小字里的出处,如 `/alg/3x3/pll`;省略则不写 */
  sourcePath?: string;
  filename: string;
  /** 这个 case 该用第几个视角(页面上的 y 切换);默认 0 */
  oriOf?: (c: AlgCase) => number;
  /** 公式筛选(标签筛选);默认全要 */
  algFilter?: (a: AlgEntry) => boolean;
  /** 覆盖某个 case/视角的公式行；缩略图仍取原 case 的首条公式。 */
  algsFor?: (c: AlgCase, orientation: number) => readonly AlgEntry[];
  /** 子组名 → 打印用的标题(1LLL 组号换字母制 OLL 名之类) */
  groupLabel?: (subgroup: string) => string;
  /** case → PDF 一级分节标题；SQ1 EP 用它先分“无特 / 有特”，再按顶层 case 分组。 */
  sectionOf?: (c: AlgCase) => string | undefined;
  /** case → PDF 中显示的名字；默认与网页的标准主名一致。 */
  caseLabel?: (c: AlgCase) => string;
  /**
   * 不剥收尾 AUF。3BLD 换位子那两套**必须**开:818 条里有 229 条真的以 U/U'/U2
   * 收尾,剥了就是条错公式(见 alg/3bld/comm 页头注)。
   */
  rawAlg?: boolean;
  /** 出不出缩略图。默认出;换位子字典 818 张图纯属浪费纸,那边关掉。 */
  thumbs?: boolean;
  /** 印不印「摆出这个 case 的打乱」。默认印;纯文字表(换位子)关掉省一半行数。 */
  setups?: boolean;
  /** 主名后面那截灰色小字。默认是 `#编号`;换位子表拿它挂中文联想词。 */
  subOf?: (c: AlgCase) => string | undefined;
  /**
   * 每个视角各印一份(名字后缀标 `FR` / `FL`…)。单张 case 的详情页用 —— 那页本来
   * 就把每个视角都列出来了;列表页不开,否则 f2l 一套直接翻四倍。
   */
  allOris?: boolean;
  /**
   * 每个 case 最多印几条公式。默认 {@link DEFAULT_MAX_ALGS} —— 库里一张 PLL 挂着
   * 十几条备选,全印出来一套 PLL 就是五页纸,而打印要的是「这个 case 我练哪条」。
   * 顺序即优先级(第一条是主推解法),所以砍掉的是尾巴。传 `Infinity` 全印。
   */
  maxAlgs?: number;
  /** 每个子组另起一页(见 {@link AlgPdfSheetInput.groupPerPage});只有一个子组时自动失效。 */
  groupPerPage?: boolean;
  /** Square-1 当前的顶面配色；打印图必须跟网页同步。 */
  sq1BlackTop?: boolean;
  /** 识别简化图开关；网页与 PDF 必须使用同一张渲染计划。 */
  simplifyRecognition?: boolean;
  /** 顶层 case 的观察角度；打乱、缩略图与公式一起旋转。 */
  viewAngle?: CaseViewAngle;
  /** 网页当前选择的魔方拿法；PDF 缩略图必须同步。 */
  orientation?: string;
}

export function algSheetFromCases(o: FromCasesOptions): AlgSheetInput {
  const {
    puzzle, set, cases, oriOf, algFilter, groupLabel, rawAlg,
    thumbs = true, setups = true, subOf, maxAlgs = DEFAULT_MAX_ALGS,
  } = o;

  // 只有一个子组时不出组标题 —— 一条横贯标题下面挂着全部 case,等于白占一行
  const groups = new Set(cases.map(c => c.subgroup || ''));
  const showGroups = groups.size > 1;

  const out: AlgPdfCase[] = [];
  for (const c of cases) {
    const rawOri = oriOf?.(c) ?? 0;
    const oris = o.allOris
      ? c.algs.map((_, i) => i)
      : [rawOri < c.algs.length ? rawOri : 0];
    for (const oriIdx of oris) {
      const allForOri = c.algs[oriIdx] ?? c.algs[0] ?? [];
      const displayAlgs = o.algsFor?.(c, oriIdx) ?? allForOri;
      const picked = (algFilter ? displayAlgs.filter(algFilter) : displayAlgs).slice(0, maxAlgs);
      // 印出来的打乱跟着视角转 —— 图是按 `oriAdjustSetup` 画的,打乱不跟着就摆不出图上那个态
      const setup = caseViewSetup(oriAdjustSetup(c.setup, oriIdx), o.viewAngle ?? 'default');
      // 图取未筛选的首条 —— 筛选只该影响印出来的公式,不该换掉这张 case 的图
      const firstAlg = caseViewAlg(allForOri[0]?.alg ?? c.standard ?? '', o.viewAngle ?? 'default');
      const sub = c.subgroup || '';
      const oriName = oris.length > 1 ? shortOriName(c.oriNames?.[oriIdx] ?? '') : '';
      out.push({
        name: o.caseLabel?.(c) ?? primaryCaseName(puzzle, set, c),
        sub: oriName || (subOf ? subOf(c) : (c.number != null ? `#${c.number}` : undefined)),
        section: o.sectionOf?.(c),
        group: showGroups ? (groupLabel?.(sub) ?? sub ?? undefined) : undefined,
        setup: setups && setup ? formatScrambleForEvent(puzzle, setup) : undefined,
        algs: picked.map(e => {
          const angled = caseViewAlg(e.alg, o.viewAngle ?? 'default');
          return formatScrambleForEvent(puzzle, rawAlg ? angled : displayAlg(angled));
        }),
        thumb: thumbs
          ? {
              puzzle, set, caseName: c.name, sticker: c.sticker, alg: firstAlg || c.setup || '', setup, size: 160,
              ...(puzzle === 'sq1' ? { sq1BlackTop: o.sq1BlackTop ?? true } : {}),
              ...(o.simplifyRecognition ? { simplifyRecognition: true } : {}),
              ...(o.orientation !== undefined ? { orientation: o.orientation } : {}),
            }
          : undefined,
      });
    }
  }

  // 数的是**几张 case**,不是印了几格 —— allOris 下一张 case 会摊成四格(FR/FL/BL/BR),
  // 写「4 cases」就成了骗人
  const n = cases.length;
  const count = `${n} ${n === 1 ? 'case' : 'cases'}`;
  return {
    title: o.title,
    subtitle: o.sourcePath ? `${count} — cuberoot.me${o.sourcePath}` : count,
    cases: out,
    filename: o.filename,
    groupPerPage: showGroups && o.groupPerPage,
  };
}
