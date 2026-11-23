import React from 'react';
import {Composition} from 'remotion';
import {AppShort} from './AppShort';
import {durationInFrames, type VideoProject} from '../schema';

const fallback: VideoProject = {
  schemaVersion: 1,
  app: {name: 'Sample App', category: 'Productivity', audience: '毎日を効率化したい人', valueProposition: '作業を簡単にします'},
  brand: {primaryColor: '#6C5CE7', secondaryColor: '#00CEC9', backgroundColor: '#111322', textColor: '#FFFFFF', fontFamily: 'sans-serif'},
  video: {title: 'Sample', fps: 30, width: 1080, height: 1920, scenes: [
    {type: 'hook', durationSeconds: 3, headline: 'その作業、\nまだ手動ですか？', layout: 'center'},
    {type: 'cta', durationSeconds: 3, headline: 'Sample Appで\n始めよう', layout: 'center'},
  ]},
};

export const RemotionRoot = () => <Composition
  id="AppShort"
  component={AppShort}
  width={1080}
  height={1920}
  fps={30}
  durationInFrames={durationInFrames(fallback)}
  defaultProps={{project: fallback}}
  calculateMetadata={({props}) => ({durationInFrames: durationInFrames(props.project), fps: props.project.video.fps, width: props.project.video.width, height: props.project.video.height})}
/>;
