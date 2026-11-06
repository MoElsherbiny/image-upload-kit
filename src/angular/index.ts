export * from './types';
export {
  createComputed,
  createSignal,
  type SubscribableDependency,
} from './signals';
export {
  type AngularValueProvider,
  IMAGE_UPLOAD_CONFIG_TOKEN,
  injectImageUploadConfig,
  provideImageUploadConfig,
  resetImageUploadConfig,
} from './config';
export {
  type AngularImageRevealController,
  createFallbackBlurSvg,
  createImageReveal,
  DEFAULT_NEUTRAL_COLORS,
  resolveBackgroundColor,
  resolveIntrinsicPlaceholderUrl,
  resolveMeaningfulColor,
  resolvePlaceholderUrl,
} from './controllers/imageReveal';
export {
  type AngularSingleUploadController,
  createSingleUpload,
} from './controllers/singleUpload';
export {
  type AngularMultiUploadController,
  createMultiUpload,
} from './controllers/multiUpload';
export {
  AnimatedImageComponent,
  mountAnimatedImage,
  type MountedAnimatedImage,
} from './components/animatedImage';
export {
  mountMultiImageUpload,
  mountSingleImageUpload,
  type MountedMultiImageUpload,
  type MountedSingleImageUpload,
  MultiImageUploadComponent,
  SingleImageUploadComponent,
} from './components/uploadElements';
