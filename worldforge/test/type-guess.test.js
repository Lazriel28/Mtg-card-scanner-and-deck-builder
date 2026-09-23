'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { guessTypeFromContent } = require('../src/types');

test('content decides the type, not the folder name', () => {
  // Lives in "Garage/" — still a character by its text.
  const person = guessTypeFromContent(
    'Lazriel, the Dagger Crow\n\nAppearance: black feathered cloak. Personality: patient, lethal.\nBackstory: born in the 9th Circle. Goals: none stated. Allies: Vesper.',
    []);
  assert.strictEqual(person, 'character');
});

test('locations, items, and lore are recognized from their text', () => {
  const place = guessTypeFromContent('Saltmere\n\nPopulation: 4,000. Located on the western cliffs. Climate: foggy. Notable places: the Tide Steps, Lantern Row.', []);
  assert.strictEqual(place, 'location');

  const item = guessTypeFromContent('Vengeance - War Wagon\n\nWeight: 3.1 t. Engine: twin-turbo V8. Armor: B7. Price: on request. Armament: none, prototype.', []);
  assert.strictEqual(item, 'item');

  const lore = guessTypeFromContent('The Veil Concordat\n\nHistory: signed after the War of Ash. Religion: forbidden. Timeline: Third Era. Factions: the Signatories.', []);
  assert.strictEqual(lore, 'lore');
});

test('a matching tag outweighs ambiguous text', () => {
  const t = guessTypeFromContent('They say the city burned. Some story.', ['lore']);
  assert.strictEqual(t, 'lore');
});

test('too little signal stays untyped', () => {
  assert.strictEqual(guessTypeFromContent('WIP', []), null);
  assert.strictEqual(guessTypeFromContent('', []), null);
  // a shopping-list-ish note shouldn't inherit a strong type
  assert.strictEqual(guessTypeFromContent('buy bread\nfix the sink', []), null);
});
