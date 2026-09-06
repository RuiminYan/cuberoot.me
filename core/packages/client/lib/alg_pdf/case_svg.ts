/**
 * 一张 case 的缩略图 → **SVG 字符串**(PDF 导出用)。
 *
 * 屏幕上那张图走 `<CaseThumb>`(React 组件树);PDF 里要的是能喂给 svg2pdf 的字符串。
 * 二者不再各自判断拼图和视图:都只消费 `caseThumbPlan()`,本文件仅把计划适配成字符串。
 *
 * 全部本地渲染,不发网络请求 —— 一份 PDF 动辄几百张图,走 `/v1/visualcube.svg`
 * 就是几百个请求。
 */
import { renderFromSimpleQuery } from '@cuberoot/visualcube';
import type { AlgPuzzle, AlgSticker } from '@cuberoot/shared';
import { caseThumbPlan } from '@/lib/alg_thumb_plan';
import { renderEngineSvg, engineForwardAlg } from '@/components/EnginePuzzleSVG';

export interface CaseSvgInput {
  puzzle: AlgPuzzle;
  set: string;
  caseName?: string;
  sticker: AlgSticker;
  /** 这张卡当前显示的公式(= case 态的解法,逆着看) */
  alg: string;
  /** 有 setup 就直接正向摆到 case 态,不用逆公式 */
  setup?: string;
  /** 显式遮罩(二级选择页那种 `coll` 掩码);SR 拼图忽略 */
  mask?: string;
  /** SVG 的标称边长(px)。PDF 里最终尺寸由 svg2pdf 的 viewBox 缩放定,这里只影响描边比例。 */
  size?: number;
  /** Square-1 网页当前是否使用黑顶；PDF 必须跟随。 */
  sq1BlackTop?: boolean;
  /** Keep PDF recognition sheets consistent with the on-screen simplified projection. */
  simplifyRecognition?: boolean;
  /** Keep PDF cube colors consistent with the selected on-screen holding. */
  orientation?: string;
}

/** sr-puzzlegen 是 DOM 渲染器(往宿主元素里塞 <svg>),借个离屏容器取字符串。 */
let srHost: HTMLDivElement | null = null;
function getSrHost(): HTMLDivElement {
  if (srHost && srHost.isConnected) return srHost;
  const div = document.createElement('div');
  div.style.cssText = 'position:fixed;left:-99999px;top:-99999px;visibility:hidden;pointer-events:none;';
  document.body.appendChild(div);
  srHost = div;
  return div;
}

async function renderSrSvg(type: string, puzzle: Record<string, unknown>, size: number): Promise<string | null> {
  const mod = await import('@cuberoot/vendor-sr-puzzlegen');
  const host = getSrHost();
  host.innerHTML = '';
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mod.SVG(host, type as any, { width: size, height: size, puzzle } as any);
    // sr 往宿主里塞的是 `<div class="svg-renderer"><svg>…`,取里面那层 —— 直接拿
    // innerHTML 的话根节点是 div,svg2pdf 认不出来,图会**静默**不出现。
    return host.querySelector('svg')?.outerHTML ?? null;
  } catch (err) {
    console.warn('[alg_pdf] sr render failed', type, err);
    return null;
  } finally {
    host.innerHTML = '';
  }
}

/** 同一张图在一份 PDF 里会被反复要(组封面 / 同 case 多视角),缓存住。 */
const cache = new Map<string, string | null>();
const CACHE_CAP = 4000;

export async function algCaseSvg(input: CaseSvgInput): Promise<string | null> {
  const { puzzle, set, caseName, sticker, alg, setup, mask, size = 160, sq1BlackTop = true, simplifyRecognition = false, orientation } = input;
  const key = `${puzzle}|${set}|${caseName ?? ''}|${JSON.stringify(sticker)}|${mask ?? ''}|${size}|${sq1BlackTop}|${simplifyRecognition}|${orientation ?? ''}|${setup ?? ''}|${alg}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const svg = await renderCaseSvg(input);
  if (cache.size >= CACHE_CAP) cache.clear();
  cache.set(key, svg);
  return svg;
}

async function renderCaseSvg({
  puzzle, set, caseName, sticker, alg, setup, mask, size = 160, sq1BlackTop, simplifyRecognition, orientation,
}: CaseSvgInput): Promise<string | null> {
  const plan = caseThumbPlan({ puzzle, set, caseName, sticker, alg, setup, mask, sq1BlackTop, simplifyRecognition, orientation });
  if (plan.renderer === 'inline-svg') return plan.svg || null;
  if (plan.renderer === 'asset') {
    try {
      const blob = await fetch(plan.src).then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.blob();
      });
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${plan.width} ${plan.height}"><image href="${dataUrl}" width="${plan.width}" height="${plan.height}" /></svg>`;
    } catch (err) {
      console.warn('[alg_pdf] case asset render failed', plan.src, err);
      return null;
    }
  }
  if (plan.renderer === 'engine') {
    return renderEngineSvg(plan.puzzle, engineForwardAlg(plan.puzzle, plan.driver), size);
  }
  if (plan.renderer === 'sr') {
    return renderSrSvg(plan.kind, plan.driver, size);
  }
  const p = plan.params;
  return renderFromSimpleQuery({
    ...(p.faceletColors
      ? { fc: p.faceletColors, ...(p.faceletAlg ? { alg: p.faceletAlg } : {}) }
      : plan.setup ? { setup: plan.setup } : { case: plan.algorithm }),
    view: p.view,
    size,
    pzl: p.puzzleSize,
    ...(p.mask ? { mask: p.mask } : {}),
    ...(p.scheme ? { sch: p.scheme } : {}),
    ...(p.hideGreySides ? { ngs: '1' } : {}),
    ...(p.planSimplify?.side ? { psr: p.planSimplify.side } : {}),
    ...(p.planSimplify?.up ? { pur: p.planSimplify.up } : {}),
    ...(p.planSimplify?.showYellow !== undefined ? { psy: p.planSimplify.showYellow ? '1' : '0' } : {}),
    ...(p.planSimplify?.forceShow ? { pfs: p.planSimplify.forceShow } : {}),
    ...(p.planSimplify?.forceHide ? { pfh: p.planSimplify.forceHide } : {}),
  });
}
