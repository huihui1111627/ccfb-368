import type { ProjectState } from '../../types';
import { uid } from '../math/vec2';
import { createProceduralPuppet, PUPPET_STYLES } from '../puppet/procedural';

export function defaultProject(): ProjectState {
  const warrior = createProceduralPuppet(PUPPET_STYLES[0]);
  const scholar = createProceduralPuppet(PUPPET_STYLES[1]);
  return {
    name: '我的第一出皮影戏',
    puppets: [warrior, scholar],
    instances: [
      {
        id: uid('inst'),
        defId: warrior.id,
        name: '武将·甲',
        x: -120,
        y: 40,
        scale: 1,
        rotation: 0,
        layer: 0,
        visible: true,
        ikChains: [
          { id: uid('ik'), name: '左臂', rootBoneId: 'shoulderL', midBoneId: 'elbowL', endBoneId: 'wristL', pole: 1 },
          { id: uid('ik'), name: '右臂', rootBoneId: 'shoulderR', midBoneId: 'elbowR', endBoneId: 'wristR', pole: -1 },
          { id: uid('ik'), name: '左腿', rootBoneId: 'hipL', midBoneId: 'kneeL', endBoneId: 'ankleL', pole: 1 },
          { id: uid('ik'), name: '右腿', rootBoneId: 'hipR', midBoneId: 'kneeR', endBoneId: 'ankleR', pole: -1 },
        ],
      },
      {
        id: uid('inst'),
        defId: scholar.id,
        name: '文人·乙',
        x: 140,
        y: 40,
        scale: 0.95,
        rotation: 0,
        layer: 1,
        visible: true,
        ikChains: [
          { id: uid('ik'), name: '左臂', rootBoneId: 'shoulderL', midBoneId: 'elbowL', endBoneId: 'wristL', pole: 1 },
          { id: uid('ik'), name: '右臂', rootBoneId: 'shoulderR', midBoneId: 'elbowR', endBoneId: 'wristR', pole: -1 },
          { id: uid('ik'), name: '左腿', rootBoneId: 'hipL', midBoneId: 'kneeL', endBoneId: 'ankleL', pole: 1 },
          { id: uid('ik'), name: '右腿', rootBoneId: 'hipR', midBoneId: 'kneeR', endBoneId: 'ankleR', pole: -1 },
        ],
      },
    ],
    timeline: { duration: 6, fps: 30, channels: [] },
    light: {
      x: 0,
      y: -60,
      color: [1.0, 0.82, 0.55],
      intensity: 1.15,
      swayAmp: 26,
      swaySpeed: 0.9,
      shadowOpacity: 0.55,
      shadowBlur: 0.6,
    },
    stageColor: '#f4e2b8',
    savedAt: 0,
  };
}
