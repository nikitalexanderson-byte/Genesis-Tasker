import {Children, cloneElement, isValidElement, type ReactNode} from 'react';
import {effectiveTodayBlockOrder, type TodayBlockId} from './today-block-order';
import './today-block-order.css';

type BlockProps = {id: TodayBlockId | 'hero'; children: ReactNode};

/** Layout-neutral slots retain stable identities even while their content is
 * hidden by account settings, subscription or the current day's conditions. */
export function TodayBlock({id, children}: BlockProps) {
  return <div className="today-block-slot" data-today-block={id}>{children}</div>;
}

/** Reorder the React tree itself, keeping reading, focus and visual order equal. */
export function TodayBlocks({order, children}: {order: readonly TodayBlockId[] | null; children: ReactNode}) {
  const blocks = new Map<string, ReactNode>();
  Children.forEach(children, child => {
    if (isValidElement<BlockProps>(child) && child.type === TodayBlock) blocks.set(child.props.id, cloneElement(child, {key: child.props.id}));
  });
  return <div className="today-view" data-exp-layout="view">
    {blocks.get('hero')}
    {effectiveTodayBlockOrder(order).map(id => blocks.get(id))}
  </div>;
}
