import { setup } from 'xstate';

/** Which screen the game shows: the menu, a flight, or the card after it ends. */
export const screenMachine = setup({
  types: { events: {} as { type: 'START' } | { type: 'MENU' } | { type: 'FINISH' } },
}).createMachine({
  id: 'screen',
  initial: 'menu',
  states: {
    menu: { on: { START: 'flying' } },
    flying: { on: { START: 'flying', MENU: 'menu', FINISH: 'ended' } },
    ended: { on: { START: 'flying', MENU: 'menu' } },
  },
});
