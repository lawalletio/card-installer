import {Skin} from '../types/skin';

// Pre-require all images to avoid creating new references on every import
const halloweenImage = require('../image/cards/halloween23.png');
const labitconfImage = require('../image/cards/labitconf23.png');
const tothemoonImage = require('../image/cards/tothemoon.png');
const lunarpunkImage = require('../image/cards/lunarpunk.png');
const solarpunkImage = require('../image/cards/solarpunk.png');
const honeybadgerImage = require('../image/cards/honeybadger.png');
const lightningImage = require('../image/cards/lightning.png');
const revolucionImage = require('../image/cards/revolucion.png');
const halvingiscomingImage = require('../image/cards/halvingiscoming.png');
const secondbestImage = require('../image/cards/secondbest.png');
const labitconfGreenImage = require('../image/cards/labitconf-green.png');

export const skins: Skin[] = [
  {
    label: 'Blank',
    value: 'fd54e006-a714-4699-9fd0-3898c622aed8',
    file: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcT32B4Dpn2fyQ94N6O_-q7q8e_jx7I-eBMn6A&s',
  },
  {
    label: 'Halloween',
    value: 'c252f9d8-6c89-4e07-a481-82cef8169a14',
    file: halloweenImage,
  },
  {
    label: 'LABITCONF',
    value: '5a69866c-06d1-4761-be8e-28d52c337abd',
    file: labitconfImage,
  },
  {
    label: 'To the moon',
    value: 'f4c5d58b-1476-470a-880c-e42ef2d95484',
    file: tothemoonImage,
  },
  {
    label: 'Lunar Punk',
    value: 'b1b95247-98b8-4d1c-ba2c-f11a743fddc4',
    file: lunarpunkImage,
  },
  {
    label: 'Solar Punk',
    value: '43171fff-5b0a-4f89-aa3b-465db7792de9',
    file: solarpunkImage,
  },
  {
    label: 'Honeybadger',
    value: '70d31cc4-cc8b-4587-8681-246616195ddf',
    file: honeybadgerImage,
  },
  {
    label: 'Lightning',
    value: 'c2f96146-e3e5-405b-b3e0-5c7ef05473f7',
    file: lightningImage,
  },
  {
    label: 'Revolucion',
    value: '6783cc8c-79d0-4e32-8457-aa13bb34649c',
    file: revolucionImage,
  },
  {
    label: 'Halving is coming',
    value: 'a0f6803c-a75a-49d5-89e9-fb091aab4ede',
    file: halvingiscomingImage,
  },
  {
    label: 'Theres no second best',
    value: '0f7a4368-03ac-4b11-aafe-41a520759e2d',
    file: secondbestImage,
  },
  {
    label: '* LABITCONF Green',
    value: '0946745e-a0cd-4ce1-af4f-6e1b5bb2a56f',
    file: labitconfGreenImage,
  },
];
