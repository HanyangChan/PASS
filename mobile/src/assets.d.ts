declare module '*.svg' {
  import { FunctionComponent } from 'react';
  import { SvgProps } from 'react-native-svg';
  const component: FunctionComponent<SvgProps>;
  export default component;
}
