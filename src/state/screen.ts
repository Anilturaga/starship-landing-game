import { setup } from 'xstate';

/** Which screen the game shows: the menu, a flight (or the menu over a paused one), or the card after it ends. */
export const screenMachine = setup({
  types: { events: {} as { type: 'START' | 'MENU' | 'RESUME' | 'FINISH' } },
}).createMachine({
  id: 'screen',
  initial: 'menu',
  states: {
    menu: { on: { START: 'flying' } },
    flying: { on: { START: 'flying', MENU: 'paused', FINISH: 'ended' } },
    paused: { on: { START: 'flying', RESUME: 'flying' } },
    ended: { on: { START: 'flying', MENU: 'menu' } },
  },
});
