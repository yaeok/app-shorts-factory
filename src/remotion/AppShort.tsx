import React from 'react';
import {AbsoluteFill, Img, Sequence, interpolate, staticFile, useCurrentFrame} from 'remotion';
import type {Scene, VideoProject} from '../schema';

const SceneView: React.FC<{scene: Scene; project: VideoProject; frames: number}> = ({scene, project, frames}) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 8, Math.max(9, frames - 8), frames], [0, 1, 1, 0], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  const translateY = interpolate(frame, [0, 12], [36, 0], {extrapolateRight: 'clamp'});
  const mediaFirst = scene.layout === 'media-top';
  const asset = scene.asset ? <Img src={staticFile(scene.asset)} style={{width: '82%', maxHeight: 820, objectFit: 'contain', borderRadius: 44, boxShadow: '0 28px 80px #0005'}} /> : null;
  const copy = <div style={{display: 'flex', flexDirection: 'column', gap: 30, alignItems: 'center'}}>
    {scene.eyebrow && <div style={{fontSize: 38, fontWeight: 800, color: project.brand.secondaryColor, letterSpacing: 2}}>{scene.eyebrow}</div>}
    <div style={{fontSize: scene.type === 'hook' ? 104 : 82, fontWeight: 900, lineHeight: 1.12, textAlign: 'center', whiteSpace: 'pre-line'}}>{scene.headline}</div>
    {scene.body && <div style={{fontSize: 46, fontWeight: 600, lineHeight: 1.35, textAlign: 'center', whiteSpace: 'pre-line', opacity: 0.9}}>{scene.body}</div>}
  </div>;
  return <AbsoluteFill style={{backgroundColor: scene.backgroundColor ?? project.brand.backgroundColor, color: project.brand.textColor, fontFamily: project.brand.fontFamily, padding: '150px 82px', display: 'flex', justifyContent: 'center', alignItems: 'center'}}>
    <div style={{opacity, transform: `translateY(${translateY}px)`, width: '100%', display: 'flex', flexDirection: 'column', gap: 72, alignItems: 'center'}}>
      {mediaFirst && asset}{copy}{!mediaFirst && asset}
    </div>
    <div style={{position: 'absolute', bottom: 60, left: 70, right: 70, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 18, fontSize: 34, fontWeight: 800}}>
      {project.app.logo && <Img src={staticFile(project.app.logo)} style={{width: 64, height: 64, borderRadius: 15}} />}
      {project.app.name}
    </div>
  </AbsoluteFill>;
};

export const AppShort: React.FC<{project: VideoProject}> = ({project}) => {
  let from = 0;
  return <AbsoluteFill>{project.video.scenes.map((scene, index) => {
    const frames = Math.round(scene.durationSeconds * project.video.fps);
    const sequence = <Sequence key={`${scene.type}-${index}`} from={from} durationInFrames={frames} premountFor={15}><SceneView scene={scene} project={project} frames={frames} /></Sequence>;
    from += frames;
    return sequence;
  })}</AbsoluteFill>;
};
