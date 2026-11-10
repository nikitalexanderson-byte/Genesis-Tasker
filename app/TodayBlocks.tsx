import {Children, cloneElement, isValidElement, type ReactNode} from 'react';
import {effectiveTodayBlockOrder, todayHalfBlocks, type TodayBlockId} from './today-block-order';
import './today-block-order.css';

type BlockProps = {id: TodayBlockId | 'hero'; half?: boolean; children: ReactNode};

/** Layout-neutral slots retain stable identities even while their content is
 * hidden by account settings, subscription or the current day's conditions. */
export function TodayBlock({id, half, children}: BlockProps) {
  return <div className="today-block-slot" data-today-block={id} data-half={half || undefined}>{children}</div>;
}

/** Reorder the React tree itself, keeping reading, focus and visual order equal. */
export function TodayBlocks({order, halfBlocks = [], children}: {order: readonly TodayBlockId[] | null; halfBlocks?: readonly TodayBlockId[]; children: ReactNode}) {
  const halves = todayHalfBlocks(halfBlocks);
  const blocks = new Map<string, ReactNode>();
  Children.forEach(children, child => {
    if (isValidElement<BlockProps>(child) && child.type === TodayBlock) blocks.set(child.props.id, cloneElement(child, {key: child.props.id, half: child.props.id !== 'hero' && halves.includes(child.props.id)}));
  });
  return <div className="today-view" data-exp-layout="view" data-custom-widths={halves.length ? true : undefined}>
    {blocks.get('hero')}
    {effectiveTodayBlockOrder(order).map(id => blocks.get(id))}
  </div>;
}
