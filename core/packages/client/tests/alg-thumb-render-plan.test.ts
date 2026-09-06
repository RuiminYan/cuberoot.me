import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { AlgPuzzle } from '@cuberoot/shared';
import { buildSimpleOptions, Face, Masking, makeMasking, renderFromSimpleQuery } from '@cuberoot/visualcube';
import {
  caseThumbPlan,
  cubeThumbParams,
  DEFAULT_ALG_CUBE_ORIENTATION,
  supportsCaseViewAngle,
  supportsCubeOrientation,
  supportsRecognitionSimplification,
  type CaseThumbPlanInput,
} from '@/lib/alg_thumb_plan';
import { algCaseSvg } from '@/lib/alg_pdf/case_svg';
import { orientedCubeFaceColors } from '@/lib/cube-orientation';

// guard-registry: tracked at /dev/guards (app/[lang]/dev/guards/_guards.ts)

const RAW = { kind: 'raw' as const, tag: '', attrs: {} };
const FACE = {
  kind: 'face' as const,
  us: 'rygyyyyyy',
  ub: 'yrybbbbbb',
  uf: 'ggogggggg',
  ul: 'bbrrrrrrr',
  ur: 'boooooooo',
};

function input(puzzle: AlgPuzzle, set = 'shape'): CaseThumbPlanInput {
  return { puzzle, set, sticker: RAW, alg: '', setup: '' };
}

describe('网页与 PDF 共用 case 缩略图渲染计划', () => {
  it('所有公式库拼图都由同一计划选择渲染器', () => {
    expect(caseThumbPlan(input('2x2')).renderer).toBe('visualcube');
    expect(caseThumbPlan(input('3x3')).renderer).toBe('visualcube');
    expect(caseThumbPlan(input('4x4')).renderer).toBe('visualcube');
    expect(caseThumbPlan(input('5x5')).renderer).toBe('visualcube');
    expect(caseThumbPlan(input('sq1')).renderer).toBe('inline-svg');
    expect(caseThumbPlan(input('megaminx')).renderer).toBe('sr');
    expect(caseThumbPlan(input('pyraminx')).renderer).toBe('engine');
    expect(caseThumbPlan(input('skewb')).renderer).toBe('inline-svg');
    expect(caseThumbPlan(input('fto')).renderer).toBe('inline-svg');
  });

  it('NxN 默认沿用黄顶红前，切换拿法时网页与 PDF 一起重贴色', async () => {
    expect(DEFAULT_ALG_CUBE_ORIENTATION).toBe("z2 y'");
    const base = {
      puzzle: '3x3' as const,
      set: 'f2l',
      sticker: { kind: 'f2l' as const, fl: '' },
      alg: "R U R'",
      setup: "R U' R'",
    };
    const existing = caseThumbPlan(base);
    const standard = caseThumbPlan({ ...base, orientation: '' });
    expect(existing.renderer).toBe('visualcube');
    expect(standard.renderer).toBe('visualcube');
    if (existing.renderer !== 'visualcube' || standard.renderer !== 'visualcube') {
      throw new Error('expected visualcube plans');
    }
    expect(existing.params.scheme).toBe('ygrwbo');
    expect(standard.params.scheme).toBe('wrgyob');
    expect(orientedCubeFaceColors(DEFAULT_ALG_CUBE_ORIENTATION)).toMatchObject({
      U: '#FEFE00',
      R: '#00D800',
      F: '#EE0000',
      D: '#FFFFFF',
      L: '#0000F2',
      B: '#FFA100',
    });
    expect(supportsCubeOrientation('3x3', cubeThumbParams('3x3', 'f2l', base.sticker))).toBe(true);
    await expect(algCaseSvg({ ...base, orientation: '' }))
      .resolves.not.toBe(await algCaseSvg(base));
  });

  it('普通 F2L 有真实 setup 时不用不完整的上游投影', () => {
    const spec = {
      puzzle: '3x3' as const,
      set: 'f2l',
      sticker: {
        kind: 'f2l' as const,
        fl: 'lllllgllgllwgglggloollooloollwgglggloollooloo',
      },
      alg: "U R U' R'",
      setup: "F R' F' R",
    };
    const plan = caseThumbPlan(spec);
    expect(plan.renderer).toBe('visualcube');
    if (plan.renderer !== 'visualcube') throw new Error('expected visualcube plan');
    expect(plan.setup).toBe(spec.setup);
    expect(plan.params).toMatchObject({
      view: 'f2l',
      scheme: 'ygrwbo',
      puzzleSize: 3,
    });
    expect(plan.params.faceletColors).toBeUndefined();
    expect(plan.params.faceletAlg).toBeUndefined();
  });

  it('普通 F2L 缺失 setup 时直接拒绝,绝不读取或猜测 case 状态', () => {
    expect(() => caseThumbPlan({
      puzzle: '3x3',
      set: 'f2l',
      sticker: {
        kind: 'f2l',
        fl: 'lllllgllgllwgglggloollooloollwgglggloollooloo',
      },
      alg: "U R U' R'",
    })).toThrow('Missing required setup for 3x3/f2l');
    expect(() => caseThumbPlan({
      puzzle: '3x3',
      set: 'adv-f2l',
      sticker: { kind: 'f2l', fl: 'not-a-six-face-state' },
      alg: "U R U' R'",
    })).toThrow('Missing required setup for 3x3/adv-f2l');
  });

  it('AF2L 从真实 setup 生成状态，并按块身份隐藏标准 FR 对', async () => {
    const spec = {
      puzzle: '3x3' as const,
      set: 'adv-f2l',
      sticker: {
        kind: 'f2l' as const,
        fl: 'lllllollllllgglggwlblloloolllllgglggwlbllolool',
      },
      alg: "S R S'",
      setup: "S R S'",
    };
    const plan = caseThumbPlan(spec);
    expect(plan.renderer).toBe('visualcube');
    if (plan.renderer !== 'visualcube') throw new Error('expected visualcube plan');
    expect(plan.params).toMatchObject({
      view: 'f2l',
      mask: 'af2l',
      renderLocally: true,
      scheme: 'ygrwbo',
      puzzleSize: 3,
    });
    expect(plan.params.faceletColors).toBeUndefined();
    expect(plan.params.faceletAlg).toBeUndefined();
    expect(plan.setup).toBe(spec.setup);

    const f2l = makeMasking(Masking.F2L, 3);
    const af2l = makeMasking(Masking.AF2L, 3);
    const hiddenPairStickers = new Set([
      `${Face.R}:3`, `${Face.R}:6`,
      `${Face.F}:5`, `${Face.F}:8`,
      `${Face.D}:2`,
    ]);
    for (const face of [Face.U, Face.R, Face.F, Face.D, Face.L, Face.B]) {
      for (let index = 0; index < 9; index += 1) {
        const key = `${face}:${index}`;
        expect(af2l[face][index], key).toBe(hiddenPairStickers.has(key) ? false : f2l[face][index]);
      }
    }

    const svg = await algCaseSvg(spec);
    expect(svg).toContain('#404040');
    expect(svg).toContain('#00D800');
    expect(svg).toContain('#FFA100');
    expect(svg).toContain('#EE0000');

    const standard = caseThumbPlan({ ...spec, orientation: '' });
    expect(standard.renderer).toBe('visualcube');
    if (standard.renderer === 'visualcube') {
      expect(standard.params.mask).toBe('af2l');
      expect(standard.params.scheme).toBe('wrgyob');
      expect(standard.setup).toBe(spec.setup);
    }
  });

  it('visualcube 只接受长度匹配的最终逐贴纸颜色，无显式转体时不套默认公式', () => {
    const facelets = 'd'.repeat(54);
    const options = buildSimpleOptions({ fc: facelets, view: 'iso', size: 96 });
    expect(options.stickerColors).toEqual(Array(54).fill('#404040'));
    expect(options.algorithm).toBeUndefined();
    expect(buildSimpleOptions({ fc: facelets, alg: "y'" }).algorithm).toBe("y'");
    expect(buildSimpleOptions({ fc: 'd'.repeat(53) }).stickerColors).toBeUndefined();
    expect(buildSimpleOptions({ fc: `${'d'.repeat(53)}x` }).stickerColors).toBeUndefined();
    expect(renderFromSimpleQuery({ fc: facelets, view: 'iso', size: 96 })).toContain('#404040');
  });

  it('OLL 换拿法只改变顶色，显式教学配色不开放朝向菜单', () => {
    const oll = caseThumbPlan({ puzzle: '3x3', set: 'oll', sticker: FACE, alg: "R U R'" });
    const standard = caseThumbPlan({ puzzle: '3x3', set: 'oll', sticker: FACE, alg: "R U R'", orientation: '' });
    expect(oll.renderer).toBe('visualcube');
    expect(standard.renderer).toBe('visualcube');
    if (oll.renderer !== 'visualcube' || standard.renderer !== 'visualcube') {
      throw new Error('expected visualcube plans');
    }
    expect(oll.params.scheme).toBe('FEFE00,404040,404040,404040,404040,404040');
    expect(standard.params.scheme).toBe('FFFFFF,404040,404040,404040,404040,404040');

    const semantic = cubeThumbParams('3x3', 'oll', {
      ...FACE,
      mask: 'oll',
      scheme: 'wrgoyb',
    });
    expect(semantic.scheme).toBe('wrgoyb');
    expect(supportsCubeOrientation('3x3', semantic)).toBe(false);
  });

  it('FTO 的网页与 PDF 使用逐字相同的 EIF SVG', async () => {
    const spec = { ...input('fto', 'tcp'), alg: "Fo R U' R' U Fo'" };
    const plan = caseThumbPlan(spec);
    expect(plan.renderer).toBe('inline-svg');
    if (plan.renderer !== 'inline-svg') throw new Error('expected inline FTO SVG');
    expect(plan.svg).toContain('viewBox="0 0 279.92 301.94"');
    await expect(algCaseSvg(spec)).resolves.toBe(plan.svg);
  });

  it('所有 LowCubes FTO 阶段都优先使用本地识别图', () => {
    const plan = caseThumbPlan({
      ...input('fto', 'tl'),
      sticker: {
        kind: 'raw',
        tag: 'lowcubes-fto',
        attrs: {
          image: 'cases/fto/tl/1.webp',
          imageAlt: 'TL (Top Layer) 1',
          imageWidth: '474',
          imageHeight: '512',
        },
      },
    });
    expect(plan).toEqual({
      renderer: 'asset',
      src: '/cases/fto/tl/1.webp',
      alt: 'TL (Top Layer) 1',
      width: 474,
      height: 512,
    });
  });

  it('LowCubes Megaminx case 使用本地原图资源', () => {
    const plan = caseThumbPlan({
      ...input('megaminx', 'full-pll'),
      sticker: {
        kind: 'raw',
        tag: 'lowcubes-megaminx',
        attrs: {
          image: 'cases/megaminx/full-pll/a1p.webp',
          imageAlt: 'A1+',
          imageWidth: '300',
          imageHeight: '303',
        },
      },
    });
    expect(plan).toEqual({
      renderer: 'asset',
      src: '/cases/megaminx/full-pll/a1p.webp',
      alt: 'A1+',
      width: 300,
      height: 303,
    });
  });

  it.each(['cs', 'csp', 'co', 'eo', 'cp', 'ep', 'obl', 'parity'])('%s 的网页和 PDF 使用逐字相同的 SQ1 平面 SVG', async (set) => {
    const spec = {
      ...input('sq1', set),
      alg: '(1,0) / (-1,0)',
      sq1BlackTop: false,
    };
    const plan = caseThumbPlan(spec);
    expect(plan.renderer).toBe('inline-svg');
    if (plan.renderer !== 'inline-svg') throw new Error('expected inline Square-1 SVG');
    await expect(algCaseSvg(spec)).resolves.toBe(plan.svg);
  });

  it.each([
    {
      name: 'Right fist / Square',
      alg: '0,-1/0,1/4,0/-2,-1/2,0/-1,-2/-3,0/',
      staleSetup: '/3,0/1,2/-2,0/2,1/-4,0/0,-1',
    },
    {
      name: 'Square / Right fist',
      alg: '1,0/-1,0/0,-4/1,2/0,-2/2,1/0,3/',
      staleSetup: '/0,-3/-2,-1/0,2/-1,-2/0,4/1,0',
    },
  ])('CS $name 始终由公式反推形状,不采用截断的 setup', ({ alg, staleSetup }) => {
    const fromCase = caseThumbPlan({ ...input('sq1', 'cs'), alg, setup: staleSetup });
    const fromFormula = caseThumbPlan({ ...input('sq1', 'cs'), alg });
    const fromStaleSetup = caseThumbPlan({ ...input('sq1', 'cs'), alg: '', setup: staleSetup });
    expect(fromCase.renderer).toBe('inline-svg');
    expect(fromFormula.renderer).toBe('inline-svg');
    expect(fromStaleSetup.renderer).toBe('inline-svg');
    if (
      fromCase.renderer !== 'inline-svg'
      || fromFormula.renderer !== 'inline-svg'
      || fromStaleSetup.renderer !== 'inline-svg'
    ) throw new Error('expected inline Square-1 SVG');
    expect(fromCase.svg).toBe(fromFormula.svg);
    expect(fromCase.svg).not.toBe(fromStaleSetup.svg);
  });

  it('SQ1 黑顶开关进入共享计划和 PDF 缓存键', async () => {
    const base = { ...input('sq1', 'cp'), alg: '(1,0) / (-1,0)' };
    const black = caseThumbPlan({ ...base, sq1BlackTop: true });
    const yellow = caseThumbPlan({ ...base, sq1BlackTop: false });
    const sideBySide = caseThumbPlan({ ...base, sq1SideBySide: true });
    expect(black.renderer).toBe('inline-svg');
    expect(yellow.renderer).toBe('inline-svg');
    expect(sideBySide.renderer).toBe('inline-svg');
    if (black.renderer !== 'inline-svg' || yellow.renderer !== 'inline-svg' || sideBySide.renderer !== 'inline-svg') {
      throw new Error('expected inline Square-1 SVG');
    }
    expect(black.svg).not.toBe(yellow.svg);
    expect(sideBySide.layout).toBe('side-by-side-layers');
    const [, , width, height] = sideBySide.svg.match(/viewBox="([^"]+)"/)![1].split(' ').map(Number);
    expect(width).toBeGreaterThan(height);
    await expect(algCaseSvg({ ...base, sq1BlackTop: true })).resolves.toBe(black.svg);
    await expect(algCaseSvg({ ...base, sq1BlackTop: false })).resolves.toBe(yellow.svg);
  });

  it('3x3 识别简化进入网页与 PDF 共用计划，其他阶数不误用', async () => {
    const base = { puzzle: '3x3' as const, set: 'zbll', sticker: FACE, alg: "R U R'", setup: "R U R'" };
    const plain = caseThumbPlan(base);
    const simplified = caseThumbPlan({ ...base, simplifyRecognition: true });
    expect(plain.renderer).toBe('visualcube');
    expect(simplified.renderer).toBe('visualcube');
    if (plain.renderer !== 'visualcube' || simplified.renderer !== 'visualcube') {
      throw new Error('expected visualcube plans');
    }
    expect(plain.params.planSimplify).toBeUndefined();
    expect(simplified.params.planSimplify).toEqual({ side: 'oppbar', up: 'all', showYellow: true });
    expect(simplified.setup).toBe(plain.setup);
    expect(simplified.algorithm).toBe(plain.algorithm);
    await expect(algCaseSvg({ ...base, simplifyRecognition: true }))
      .resolves.not.toBe(await algCaseSvg(base));

    const four = caseThumbPlan({ ...base, puzzle: '4x4', simplifyRecognition: true });
    expect(four.renderer).toBe('visualcube');
    if (four.renderer === 'visualcube') expect(four.params.planSimplify).toBeUndefined();
  });

  it('OLL 系列已经是简化朝向图，不再提供无效的二次简化', () => {
    for (const set of ['oll', '2-look-oll']) {
      const params = cubeThumbParams('3x3', set, FACE);
      expect(params.view).toBe('oll');
      expect(supportsRecognitionSimplification(params)).toBe(false);

      const plan = caseThumbPlan({ puzzle: '3x3', set, sticker: FACE, alg: "R U R'", simplifyRecognition: true });
      expect(plan.renderer).toBe('visualcube');
      if (plan.renderer === 'visualcube') expect(plan.params.planSimplify).toBeUndefined();
    }

    expect(supportsRecognitionSimplification(cubeThumbParams('3x3', 'zbll', FACE))).toBe(true);
  });

  it('2-look OLL 七个角块图与 OLL 页面一致，H 图旋转 90 度', () => {
    const refs: Record<string, string> = {
      Sune: "R U2' R' U' R U' R'",
      Antisune: "R U R' U R U2' R' y'",
      'H OLL': "R U R' U R U' R' U R U2' R'",
      'T OLL': "F R' F' r U R U' r'",
      'L OLL': "R' F' r U R U' r' F y'",
      'Pi OLL': "R' U2' R2' U R2' U R2' U2' R'",
      'U OLL': "R U2' R D R' U2' R D' R2' y2",
    };
    for (const [caseName, setup] of Object.entries(refs)) {
      const plan = caseThumbPlan({
        puzzle: '3x3',
        set: '2-look-oll',
        caseName,
        sticker: FACE,
        alg: 'ignored for setup-backed diagrams',
        setup: 'the database setup is replaced for this diagram',
      });
      expect(plan.renderer).toBe('visualcube');
      if (plan.renderer !== 'visualcube') continue;
      expect(plan.params).toEqual({
        view: 'oll',
        hideGreySides: true,
        scheme: 'FEFE00,404040,404040,404040,404040,404040',
        puzzleSize: 3,
      });
      expect(plan.setup).toBe(setup);
      expect(renderFromSimpleQuery({ view: 'oll', size: 88, setup: plan.setup, ngs: '1' }))
        .toBe(renderFromSimpleQuery({ view: 'oll', size: 88, setup, ngs: '1' }));
    }
  });

  it.each(['sv', 'vls', 'wv'])('%s 共用 SV 的俯视遮罩图', (set) => {
    const params = cubeThumbParams('3x3', set, FACE);
    expect(params).toEqual({
      view: 'pll',
      mask: 'wv',
      hideGreySides: true,
      puzzleSize: 3,
    });

    const simplified = caseThumbPlan({
      puzzle: '3x3',
      set,
      sticker: FACE,
      alg: "R U R'",
      simplifyRecognition: true,
    });
    expect(simplified.renderer).toBe('visualcube');
    if (simplified.renderer !== 'visualcube') throw new Error('expected visualcube plan');
    expect(simplified.params.planSimplify?.showYellow).toBe(false);
  });

  it('OLLCP 保留角块侧色，但把棱块侧色置灰', () => {
    expect(cubeThumbParams('3x3', 'ollcp', FACE)).toEqual({
      view: 'pll',
      mask: 'ollcp',
      hideGreySides: true,
      puzzleSize: 3,
    });

    const mask = makeMasking(Masking.OLLCP, 3);
    expect(mask[Face.U]).toEqual(Array(9).fill(true));
    for (const side of [Face.R, Face.F, Face.L, Face.B]) {
      expect(mask[side]).toEqual([
        true, false, true,
        false, false, false,
        false, false, false,
      ]);
    }

    const simplified = caseThumbPlan({
      puzzle: '3x3',
      set: 'ollcp',
      sticker: FACE,
      alg: "R U2 R2 F R F' U2 R' F R F'",
      simplifyRecognition: true,
    });
    expect(simplified.renderer).toBe('visualcube');
    if (simplified.renderer !== 'visualcube') throw new Error('expected visualcube plan');
    expect(simplified.params.planSimplify).toEqual({
      side: 'oppbar',
      up: 'all',
      showYellow: true,
      forceHide: 'side=1,2,3,4,5,6,7,8,9,10,11,12',
    });
  });

  it('顶层平面图可切换观察角度，立体和槽位图不误转', () => {
    const top = { puzzle: '3x3' as const, set: 'zbll', sticker: FACE, alg: "U R U R'", setup: "R U R'" };
    const rotated = caseThumbPlan({ ...top, viewAngle: 'u' });
    expect(rotated.renderer).toBe('visualcube');
    if (rotated.renderer !== 'visualcube') throw new Error('expected visualcube plan');
    expect(rotated.setup).toBe("R U R' U");
    expect(rotated.algorithm).toBe("R U R'");
    expect(supportsCaseViewAngle(rotated.params)).toBe(true);

    const slot = caseThumbPlan({ ...top, set: 'f2l', sticker: { kind: 'f2l', fl: '' }, viewAngle: 'u' });
    expect(slot.renderer).toBe('visualcube');
    if (slot.renderer !== 'visualcube') throw new Error('expected visualcube plan');
    expect(slot.setup).toBe(top.setup);
    expect(slot.algorithm).toBe(top.alg);
    expect(supportsCaseViewAngle(slot.params)).toBe(false);

    const iso = caseThumbPlan({ ...top, set: 'lsll', sticker: RAW, viewAngle: 'u' });
    expect(iso.renderer).toBe('visualcube');
    if (iso.renderer !== 'visualcube') throw new Error('expected visualcube plan');
    expect(supportsCaseViewAngle(iso.params)).toBe(false);
  });

  it('网页适配器和 PDF 适配器都只能消费 caseThumbPlan,不能再按 puzzle 分叉', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..');
    const reactAdapter = readFileSync(join(root, 'components', 'CaseThumb.tsx'), 'utf8');
    const pdfAdapter = readFileSync(join(root, 'lib', 'alg_pdf', 'case_svg.ts'), 'utf8');
    for (const source of [reactAdapter, pdfAdapter]) {
      expect(source).toContain('caseThumbPlan(');
      expect(source).not.toMatch(/puzzle\s*===/);
      expect(source).not.toMatch(/switch\s*\(\s*puzzle\s*\)/);
    }
  });
});
