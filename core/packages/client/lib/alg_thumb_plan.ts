/**
 * One case thumbnail decision for every consumer.
 *
 * The React catalog and the PDF exporter need different output forms (React
 * nodes versus SVG strings), but they must never decide independently which
 * puzzle renderer, view, mask, or colour scheme represents a case. Both ask
 * this module for the same plan and only adapt that plan to their output API.
 */
import { requires3x3AlgCaseSetup, type AlgPuzzle, type AlgSticker } from '@cuberoot/shared';
import type { PlanSimplifyOptions } from '@cuberoot/visualcube';
import { toWca as toWcaSkewb, invert as invertSkewbAlg } from '@cuberoot/shared/skewb-notation';
import { invertSq1Alg } from '@cuberoot/shared/sq1-notation';
import { renderSkewbPyramidSvgParametric } from '@cuberoot/shared/skewb-pyramid-svg';
import { renderSq1ScrambleSvg, DEFAULT_SQ1_COLORS } from '@/lib/sq1-svg';
import { sq1StageHiddenStickerIds } from '@/lib/sq1-stage-mask';
import { caseViewAlg, caseViewSetup, type CaseViewAngle } from '@/lib/alg_display';
import { invertFtoEifAlgorithm, renderFtoEifSvg } from '@/lib/fto-eif-image';
import { visualCubeSchemeForOrientation } from '@/lib/cube-orientation';

/** 公式库沿用既有缩略图的黄顶红前拿法。 */
export const DEFAULT_ALG_CUBE_ORIENTATION = "z2 y'";

export const PUZZLE_SIZE: Record<AlgPuzzle, number> = {
  '2x2': 2, '3x3': 3, '4x4': 4, '5x5': 5,
  'sq1': 3, 'megaminx': 3, 'pyraminx': 3, 'skewb': 3, 'fto': 3,
};

const CORNER_LL_MASK: Partial<Record<string, string>> = {
  coll: 'coll',
  cmll: 'cmll',
  '2-look-cmll': 'cmll',
  'oh-cmll': 'cmll',
};

/** Only-corner masks whose grey side rim is not part of the recognition case. */
const CORNER_LL_MASK_NAMES = new Set(Object.values(CORNER_LL_MASK));

/** Last-slot sets that share the SV recognition projection. */
const SV_STYLE_SETS_3X3 = new Set(['sv', 'vls', 'wv']);
const ALL_SIDE_RING_3X3 = 'side=1,2,3,4,5,6,7,8,9,10,11,12';

export function usesSvThumbStyle(puzzle: string, set: string): boolean {
  return puzzle === '3x3' && SV_STYLE_SETS_3X3.has(set);
}

/** Shared mask for second-level umbrella cards in the library and trainer. */
export const LEVEL2_PICKER_MASK: Record<string, string> = {
  zbll: 'coll', '1lll': 'coll', ollcp: 'coll',
};

export interface CubeThumbParams {
  view: 'iso' | 'plan' | 'oll' | 'pll' | 'f2l' | 'pll-iso';
  mask?: string;
  /** Use the bundled renderer when this plan relies on a query feature that an older API may not know. */
  renderLocally?: boolean;
  faceletColors?: string;
  /** Forward whole-cube rotation applied to exact facelet colours. */
  faceletAlg?: string;
  scheme?: string;
  hideGreySides?: boolean;
  planSimplify?: PlanSimplifyOptions;
  puzzleSize: number;
}

/** Whether the optional recognition filter can remove information from this view. */
export function supportsRecognitionSimplification(params: CubeThumbParams): boolean {
  // OLL is already a yellow/grey projection with grey side stickers hidden, so
  // applying the recognition filter produces the same image.
  return params.view === 'plan' || params.view === 'pll';
}

/** Whether a case uses a flat last-layer view where a U-angle choice is meaningful. */
export function supportsCaseViewAngle(params: CubeThumbParams): boolean {
  return params.view === 'plan' || params.view === 'oll' || params.view === 'pll';
}

/** 普通 NxN 图都能换拿方；显式 scheme 表达教学语义，不能擅自重贴色。 */
export function supportsCubeOrientation(puzzle: AlgPuzzle, params: CubeThumbParams): boolean {
  return ['2x2', '3x3', '4x4', '5x5'].includes(puzzle) && !params.scheme;
}

/** The seven corner cases on the 2-look OLL page use the matching OLL diagrams. */
const TWO_LOOK_OLL_DIAGRAMS: Readonly<Record<string, string>> = {
  sune: "R U2' R' U' R U' R'",
  antisune: "R U R' U R U2' R' y'",
  'h oll': "R U R' U R U' R' U R U2' R'",
  't oll': "F R' F' r U R U' r'",
  'l oll': "R' F' r U R U' r' F y'",
  'pi oll': "R' U2' R2' U R2' U R2' U2' R'",
  'u oll': "R U2' R D R' U2' R D' R2' y2",
};

function isTwoLookOllCornerCase(caseName?: string): boolean {
  if (!caseName) return false;
  return Object.hasOwn(TWO_LOOK_OLL_DIAGRAMS, caseName.trim().toLowerCase());
}

function twoLookOllDiagramSetup(caseName: string | undefined, setup: string | undefined): string | undefined {
  const normalizedName = caseName?.trim().toLowerCase();
  if (!normalizedName || !isTwoLookOllCornerCase(normalizedName)) return setup;
  return TWO_LOOK_OLL_DIAGRAMS[normalizedName] ?? setup;
}

function pickView(
  puzzle: AlgPuzzle,
  set: string,
  sticker: AlgSticker,
): 'f2l' | 'oll' | 'pll' | 'pll-iso' {
  if (puzzle === '3x3' && sticker.kind === 'f2l') return 'f2l';
  if (set === 'oll' || set === '2-look-oll' || set === 'oll-parity') return 'oll';
  return 'pll';
}

/** Single source for every NxN thumbnail view, mask, rim rule, and order. */
export function cubeThumbParams(
  puzzle: AlgPuzzle,
  set: string,
  sticker: AlgSticker,
  maskOverride?: string,
  caseName?: string,
): CubeThumbParams {
  const puzzleSize = PUZZLE_SIZE[puzzle];
  if (puzzle === '2x2') return { view: 'plan', puzzleSize };
  if (puzzle === '3x3' && set === '2-look-oll' && isTwoLookOllCornerCase(caseName)) {
    return { view: 'oll', hideGreySides: true, puzzleSize };
  }
  if (maskOverride) {
    const hideGreySides = CORNER_LL_MASK_NAMES.has(maskOverride) || undefined;
    return { view: 'pll', mask: maskOverride, hideGreySides, puzzleSize };
  }
  if (usesSvThumbStyle(puzzle, set)) {
    return { view: 'pll', mask: 'wv', hideGreySides: true, puzzleSize };
  }
  if (puzzle === '3x3' && set === 'adv-f2l') {
    return { view: 'f2l', mask: 'af2l', renderLocally: true, puzzleSize };
  }
  if (puzzle === '3x3' && set === 'ollcp') {
    return { view: 'pll', mask: 'ollcp', hideGreySides: true, puzzleSize };
  }
  if (sticker.kind === 'face' && sticker.mask) {
    const hideGreySides = CORNER_LL_MASK_NAMES.has(sticker.mask) || set === '2-look-oll' || undefined;
    return {
      view: pickView(puzzle, set, sticker),
      mask: sticker.mask,
      scheme: sticker.scheme,
      hideGreySides,
      puzzleSize,
    };
  }
  if (puzzle === '3x3' && set === 'lsll') return { view: 'iso', puzzleSize };
  if (puzzle === '3x3' && set === 'zbls') return { view: 'iso', mask: 'vh', puzzleSize };
  const cornerMask = puzzle === '3x3' ? CORNER_LL_MASK[set] : undefined;
  if (cornerMask) return { view: 'pll', mask: cornerMask, hideGreySides: true, puzzleSize };
  const view = pickView(puzzle, set, sticker);
  return { view, hideGreySides: view === 'oll', puzzleSize };
}

type AlgDriver = { alg: string; case?: never } | { case: string; alg?: never };

export type CaseThumbPlan =
  | { renderer: 'inline-svg'; svg: string; alt: string; layout?: 'stacked-layers' | 'side-by-side-layers' }
  | { renderer: 'asset'; src: string; alt: string; width: number; height: number }
  | { renderer: 'engine'; puzzle: 'pyraminx'; driver: AlgDriver }
  | { renderer: 'sr'; kind: 'megaminx-top'; driver: AlgDriver }
  | {
      renderer: 'visualcube';
      algorithm: string;
      setup?: string;
      params: CubeThumbParams;
    };

export interface CaseThumbPlanInput {
  puzzle: AlgPuzzle;
  set: string;
  /** Canonical case name, used only for the 2-look OLL diagram correction. */
  caseName?: string;
  sticker: AlgSticker;
  alg: string;
  setup?: string;
  mask?: string;
  sq1BlackTop?: boolean;
  sq1SideBySide?: boolean;
  /** 3x3 plan-view teaching projection: hide noise without changing the case orientation. */
  simplifyRecognition?: boolean;
  /** User-selected final U-layer angle for applicable last-layer views. */
  viewAngle?: CaseViewAngle;
  /** User-selected whole-cube holding orientation. */
  orientation?: string;
}

function driverFor(setup: string | undefined, alg: string): AlgDriver {
  return setup?.trim() ? { alg: setup } : { case: alg };
}

/** Build the one renderer/view plan shared by the page and its PDF. */
export function caseThumbPlan({
  puzzle,
  set,
  caseName,
  sticker,
  alg,
  setup,
  mask,
  sq1BlackTop = true,
  sq1SideBySide = false,
  simplifyRecognition = false,
  viewAngle = 'default',
  orientation = DEFAULT_ALG_CUBE_ORIENTATION,
}: CaseThumbPlanInput): CaseThumbPlan {
  if (requires3x3AlgCaseSetup(puzzle, set) && !setup?.trim()) {
    throw new Error(`Missing required setup for ${puzzle}/${set}`);
  }

  if (puzzle === 'sq1') {
    const normalizedSet = set.toLowerCase();
    const isCubeshape = normalizedSet === 'cs' || normalizedSet === 'csp';
    // Cube-shape is defined by the solving formula itself. Some imported CS
    // setups are truncated when the formula starts with a free layer turn, so
    // deriving the case from the first formula keeps its name, alg and picture
    // on one source of truth. Other SQ1 stages still need their curated setup.
    const forward = isCubeshape && alg.trim()
      ? invertSq1Alg(alg)
      : setup?.trim() ? setup : invertSq1Alg(alg);
    const hidden = sq1StageHiddenStickerIds(set);
    const renderOptions = {
      ...(hidden ? { mask: { ids: hidden, color: 'transparent' } } : {}),
      compactFaces: !isCubeshape,
      sideBySide: sq1SideBySide,
    };
    const showMiddle = !['cs', 'csp', 'parity'].includes(normalizedSet) && !hidden;
    const colors = normalizedSet === 'cs'
      ? Object.fromEntries(
          Object.keys(DEFAULT_SQ1_COLORS).map(face => [face, 'var(--muted-foreground)']),
        )
      : sq1BlackTop
        ? { ...DEFAULT_SQ1_COLORS, U: '#000000' }
        : DEFAULT_SQ1_COLORS;
    try {
      return {
        renderer: 'inline-svg',
        svg: renderSq1ScrambleSvg(forward, colors, renderOptions, showMiddle),
        alt: 'Square-1 case',
        layout: sq1SideBySide ? 'side-by-side-layers' : 'stacked-layers',
      };
    } catch {
      return {
        renderer: 'inline-svg',
        svg: renderSq1ScrambleSvg('', colors, renderOptions, showMiddle),
        alt: 'Square-1 case',
        layout: sq1SideBySide ? 'side-by-side-layers' : 'stacked-layers',
      };
    }
  }

  if (puzzle === 'pyraminx') {
    return { renderer: 'engine', puzzle: 'pyraminx', driver: driverFor(setup, alg) };
  }

  if (puzzle === 'fto') {
    if (sticker.kind === 'raw' && sticker.tag === 'lowcubes-fto' && sticker.attrs.image) {
      return {
        renderer: 'asset',
        src: `/${sticker.attrs.image.replace(/^\/+/, '')}`,
        alt: sticker.attrs.imageAlt || 'FTO case',
        width: Number(sticker.attrs.imageWidth) || 474,
        height: Number(sticker.attrs.imageHeight) || 512,
      };
    }
    const forward = setup?.trim() ? setup : invertFtoEifAlgorithm(alg);
    return {
      renderer: 'inline-svg',
      svg: renderFtoEifSvg(forward),
      alt: 'FTO case',
    };
  }

  if (puzzle === 'skewb') {
    const driver = driverFor(setup ? toWcaSkewb(setup, 'sarah') : setup, toWcaSkewb(alg, 'sarah'));
    const scramble = driver.case !== undefined ? invertSkewbAlg(driver.case) : (driver.alg ?? '');
    try {
      return {
        renderer: 'inline-svg',
        svg: renderSkewbPyramidSvgParametric(scramble),
        alt: 'Skewb case',
      };
    } catch {
      return { renderer: 'inline-svg', svg: '', alt: 'Skewb case' };
    }
  }

  if (puzzle === 'megaminx') {
    if (sticker.kind === 'raw' && sticker.tag === 'lowcubes-megaminx' && sticker.attrs.image) {
      return {
        renderer: 'asset',
        src: `/${sticker.attrs.image.replace(/^\/+/, '')}`,
        alt: sticker.attrs.imageAlt || 'Megaminx case',
        width: Number(sticker.attrs.imageWidth) || 300,
        height: Number(sticker.attrs.imageHeight) || 303,
      };
    }
    return { renderer: 'sr', kind: 'megaminx-top', driver: driverFor(setup, alg) };
  }

  const params = cubeThumbParams(puzzle, set, sticker, mask, caseName);
  const diagramSetup = twoLookOllDiagramSetup(caseName, setup);
  const angle = supportsCaseViewAngle(params) ? viewAngle : 'default';
  const orientedScheme = supportsCubeOrientation(puzzle, params)
    ? visualCubeSchemeForOrientation(orientation, params.view === 'oll' && !params.mask)
    : params.scheme;
  return {
    renderer: 'visualcube',
    algorithm: caseViewAlg(alg, angle),
    setup: diagramSetup === undefined ? undefined : caseViewSetup(diagramSetup, angle),
    params: {
      ...params,
      ...(orientedScheme ? { scheme: orientedScheme } : {}),
      ...(puzzle === '3x3' && simplifyRecognition && supportsRecognitionSimplification(params)
        ? {
            planSimplify: {
              side: 'oppbar',
              up: 'all',
              showYellow: !usesSvThumbStyle(puzzle, set),
              ...(set === 'ollcp' ? { forceHide: ALL_SIDE_RING_3X3 } : {}),
            } satisfies PlanSimplifyOptions,
          }
        : {}),
    },
  };
}
