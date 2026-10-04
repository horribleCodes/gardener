export type LogDrawerState<E> = {
  collapsed: boolean;
  events: E[];
};

export function initialLogDrawer<E>(): LogDrawerState<E> {
  return { collapsed: false, events: [] };
}

export function toggleLogDrawer<E>(state: LogDrawerState<E>): LogDrawerState<E> {
  return { collapsed: !state.collapsed, events: state.events };
}

export function appendLogEvent<E>(state: LogDrawerState<E>, event: E): LogDrawerState<E> {
  return { collapsed: state.collapsed, events: [...state.events, event] };
}
