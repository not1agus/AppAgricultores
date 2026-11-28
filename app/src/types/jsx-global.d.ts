// React 19 dejó de exponer `JSX` como namespace global. Sigue existiendo,
// pero ahora vive bajo `React.JSX`. Para no tocar todas las firmas del
// proyecto (`: JSX.Element` en cada componente), reabrimos el namespace
// global y delegamos en `React.JSX`. Cuando el código se modernice gradualmente
// a `React.JSX.Element` o `React.ReactElement`, este shim se podrá borrar.

import type { JSX as ReactJSX } from 'react';

declare global {
  namespace JSX {
    type Element = ReactJSX.Element;
    type ElementType = ReactJSX.ElementType;
    type ElementClass = ReactJSX.ElementClass;
    type ElementAttributesProperty = ReactJSX.ElementAttributesProperty;
    type ElementChildrenAttribute = ReactJSX.ElementChildrenAttribute;
    type LibraryManagedAttributes<C, P> = ReactJSX.LibraryManagedAttributes<C, P>;
    type IntrinsicAttributes = ReactJSX.IntrinsicAttributes;
    type IntrinsicClassAttributes<T> = ReactJSX.IntrinsicClassAttributes<T>;
    type IntrinsicElements = ReactJSX.IntrinsicElements;
  }
}

export {};
