import assert from 'node:assert/strict';
import test from 'node:test';
import { calendarModule } from './helpers/calendar-modules.mjs';
const p = calendarModule('app/physis/personal-profile-domain.ts');
const n = calendarModule('app/physis/nutrition-domain.ts');
const types = calendarModule('app/physis/types.ts');
const draft = () => ({ sex: 'male', age: '35', heightCm: '182', weightKg: '82,5', activityLevel: 'moderate', fitnessGoal: 'recomposition' });

test('personal details reuse the nutrition profile and retain manually entered targets', () => {
  const current = p.defaultNutritionProfile();
  current.training = { energy: 2400, protein: 150, fat: 80, carbohydrate: 270, fiber: 30 };
  const result = p.applyPersonalProfile(current, draft());
  assert.equal(result.weightKg, 82.5);
  assert.equal(result.formulaSex, 'male');
  assert.equal(result.activityFactor, 1.55);
  assert.deepEqual(result.training, current.training);
  assert.deepEqual(result.foodRules, current.foodRules);
  assert.deepEqual(result.personal, { activityLevel: 'moderate', fitnessGoal: 'recomposition' });
  assert.ok(n.validateNutritionRecord(types.newPhysisRecord('nutrition-profile', result)));
  assert.equal(current.age, null);
});
test('all six goals survive a profile round trip and invalid personal values are rejected', () => {
  for (const fitnessGoal of Object.keys(p.FITNESS_GOALS)) {
    const result = p.applyPersonalProfile(p.defaultNutritionProfile(), { ...draft(), fitnessGoal });
    assert.equal(p.personalProfileDraft(result).fitnessGoal, fitnessGoal);
  }
  for (const patch of [{ sex: '' }, { age: '35.5' }, { heightCm: '-1' }, { weightKg: '' }, { activityLevel: 'constructor' }, { fitnessGoal: 'unknown' }]) {
    assert.throws(() => p.applyPersonalProfile(p.defaultNutritionProfile(), { ...draft(), ...patch }));
  }
  const profile = p.applyPersonalProfile(p.defaultNutritionProfile(), draft());
  assert.equal(n.validateNutritionRecord(types.newPhysisRecord('nutrition-profile', { ...profile, personal: { ...profile.personal, activityLevel: 'unknown' } })), false);
});
test('old nutrition profiles remain valid without a newly completed personal form', () => {
  const profile = p.defaultNutritionProfile();
  assert.ok(n.validateNutritionRecord(types.newPhysisRecord('nutrition-profile', profile)));
  assert.equal(p.personalProfileDraft().sex, '');
  profile.formulaSex = 'male'; profile.age = 40;
  assert.equal(p.personalProfileDraft(profile).sex, 'male');
});
