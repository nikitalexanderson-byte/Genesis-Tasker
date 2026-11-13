import type { ExerciseGuide } from './exercise-library-data.ts';

export const UPPER_BODY_EXERCISE_GUIDES: ExerciseGuide[] = [{
  id:'cable-face-pull', name:'Тяга каната к лицу', nameEn:'Cable rope face pull', muscles:'shoulders', movement:'pull', equipment:'cable', weightMode:'total',
  primary:['rear-delts','rhomboids','trapezius'], metric:'strength', unilateral:false,
  purpose:'Тренирует задние дельты и мышцы, контролирующие лопатки. Дополняет жимовые движения работой верхней части спины.',
  purposeEn:'Trains the rear deltoids and muscles that control the shoulder blades. Adds upper-back work alongside pressing exercises.',
  steps:[
    'Закрепите канатную рукоять примерно на уровне лица. Возьмитесь за её концы, отойдите от блока и устойчиво поставьте стопы; удерживайте корпус вертикально.',
    'Плавно тяните середину каната к верхней части лица, разводя кисти в стороны. Локти направляйте наружу примерно на уровне плеч; не поднимайте плечи к ушам.',
    'Остановитесь в удобной безболезненной амплитуде и подконтрольно выпрямите руки. Сохраняйте положение головы и корпуса; начните с небольшого веса.',
  ],
  stepsEn:[
    'Attach a rope handle around face height. Hold its ends, step back and establish a stable stance with the trunk upright.',
    'Pull the centre of the rope towards the upper face while separating the hands. Let the elbows move out around shoulder height without shrugging.',
    'Stop within a comfortable, pain-free range and straighten the arms under control. Keep the head and trunk still and start with a light load.',
  ],
  mistakes:'Слишком большой вес, отклонение корпуса назад, выдвижение головы к рукояти, рывки или попытка протянуть канат за голову.',
  mistakesEn:'Excessive load, leaning backwards, jutting the head towards the handle, jerking or trying to pull the rope behind the head.',
  sources:['https://www.nasm.org/resource-center/exercise-library/face-pull','https://www.nsca.com/education/articles/kinetic-select/face-pull-machine/'],
}];
