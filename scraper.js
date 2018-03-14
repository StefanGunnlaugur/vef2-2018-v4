require('dotenv').config();
require('isomorphic-fetch');

const cheerio = require('cheerio');
const redis = require('redis');
const util = require('util');

const redisOptions = {
  url: process.env.REDIS_URL,
};

const client = redis.createClient(redisOptions);

const asyncGet = util.promisify(client.get).bind(client);
const asyncSet = util.promisify(client.set).bind(client);

const cacheTtl = process.env.REDIS_EXPIRE;
/**
 * Listi af sviðum með „slug“ fyrir vefþjónustu og viðbættum upplýsingum til
 * að geta sótt gögn.
 */

const departments = [
  {
    name: 'Félagsvísindasvið',
    slug: 'felagsvisindasvid',
  },
  {
    name: 'Heilbrigðisvísindasvið',
    slug: 'heilbrigdisvisindasvid',
  },
  {
    name: 'Hugvísindasvið',
    slug: 'hugvisindasvid',
  },
  {
    name: 'Menntavísindasvið',
    slug: 'menntavisindasvid',
  },
  {
    name: 'Verkfræði- og náttúruvísindasvið',
    slug: 'verkfraedi-og-natturuvisindasvid',
  },
];

function slugCheck(slug) {
  let id = -1;
  switch (slug) {
    case 'felagsvisindasvid':
      id = '1';
      break;
    case 'heilbrigdisvisindasvid':
      id = '2';
      break;
    case 'hugvisindasvid':
      id = '3';
      break;
    case 'menntavisindasvid':
      id = '4';
      break;
    case 'verkfraedi-og-natturuvisindasvid':
      id = '5';
      break;
    default:
      id = -1;
      break;
  }
  return id;
}

async function scrape(slug) {
  const cached = await asyncGet(slug);
  if (JSON.parse(cached)) {
    return JSON.parse(cached);
  }

  const id = slugCheck(slug);
  const url = `https://ugla.hi.is/Proftafla/View/ajax.php?sid=2027&a=getProfSvids&proftaflaID=37&svidID=${id}&notaVinnuToflu=0`;
  const response = await fetch(url);
  const data = await response.json();

  await asyncSet(slug, JSON.stringify(data), 'EX', cacheTtl);

  return data;
}

scrape().catch(err => console.error(err));
/**
 * Sækir svið eftir `slug`. Fáum gögn annaðhvort beint frá vef eða úr cache.
 *
 * @param {string} slug - Slug fyrir svið sem skal sækja
 * @returns {Promise} Promise sem mun innihalda gögn fyrir svið eða null ef það finnst ekki
 */
async function getTests(slug) {
  const text = await scrape(slug);

  const { html } = text;

  const $ = cheerio.load(html);

  const deildir = $('.box h3');

  const namskeid = [];

  deildir.each((i, el) => {
    const heading = $(el).text();
    const testin = $(el).next().find('tbody').find('tr');
    const tests = [];
    testin.each((a, ul) => {
      const name = $(ul)
        .children()
        .eq(1)
        .text();
      const course = $(ul)
        .children()
        .first()
        .text();
      const type = $(ul)
        .children()
        .eq(2)
        .text();
      const studentsnum = $(ul)
        .children()
        .eq(3)
        .text();
      const students = Number(studentsnum);
      const date = $(ul)
        .children()
        .eq(4)
        .text();
      tests.push({
        course,
        name,
        type,
        students,
        date,
      });
    });
    namskeid.push({
      heading,
      tests,
    });
  });
  return namskeid;
}

getTests().catch(err => console.error(err));

/**
 * Hreinsar cache.
 *
 * @returns {Promise} Promise sem mun innihalda boolean um hvort cache hafi verið hreinsað eða ekki.
 */
async function clearCache() {
  const clear = client.flushdb((err, succeeded) => {
    console.error(err);
    return succeeded;
  });
  return clear;
}

function getSum(total, num) {
  return total + num;
}

function getMin(a, b) {
  return Math.min(a, b);
}

function getMax(a, b) {
  return Math.max(a, b);
}

async function findAmmountStudents(slug) {
  const heildarFjoldi = [];
  const text = await scrape(slug);
  const { html } = text;
  const $ = cheerio.load(html);
  const table = $('.box table')
    .find('tbody')
    .find('tr');
  table.each((i, ul) => {
    const fjoldi = $(ul)
      .children()
      .eq(3)
      .text();
    heildarFjoldi.push(fjoldi);
  });
  const result = heildarFjoldi.map(Number);
  const sumStudents = result.reduce(getSum);
  const minStudents = result.reduce(getMin);
  const maxStudents = result.reduce(getMax);
  const testAmmount = result.length;
  return {
    sumStudents,
    minStudents,
    maxStudents,
    testAmmount,
  };
}

async function getMinAmmount(a, b, c, d, e) {
  const array = [];
  array.push(a.minStudents, b.minStudents, c.minStudents, d.minStudents, e.minStudents);
  return array.reduce(getMin);
}

async function getMaxAmmount(a, b, c, d, e) {
  const array = [];
  array.push(a.maxStudents, b.maxStudents, c.maxStudents, d.maxStudents, e.maxStudents);
  return array.reduce(getMax);
}

async function getTotalAmmount(a, b, c, d, e) {
  const total = a.sumStudents + b.sumStudents + c.sumStudents + d.sumStudents + e.sumStudents;
  return total;
}

async function getTestAmmount(a, b, c, d, e) {
  const testsTotal = a.testAmmount + b.testAmmount + c.testAmmount + d.testAmmount + e.testAmmount;
  return testsTotal;
}

/**
 * Sækir tölfræði fyrir öll próf allra deilda allra sviða.
 *
 * @returns {Promise} Promise sem mun innihalda object með tölfræði um próf
 */
async function getStats() {
  const a = await findAmmountStudents('felagsvisindasvid');
  const b = await findAmmountStudents('heilbrigdisvisindasvid');
  const c = await findAmmountStudents('hugvisindasvid');
  const d = await findAmmountStudents('menntavisindasvid');
  const e = await findAmmountStudents('verkfraedi-og-natturuvisindasvid');

  const min = await getMinAmmount(a, b, c, d, e);
  const max = await getMaxAmmount(a, b, c, d, e);
  const numTests = await getTestAmmount(a, b, c, d, e);
  const numStudents = await getTotalAmmount(a, b, c, d, e);
  const avgStud = numStudents / numTests;
  const averageStudents = avgStud.toFixed(2);

  return {
    min,
    max,
    numTests,
    numStudents,
    averageStudents,
  };
}

module.exports = {
  departments,
  getTests,
  clearCache,
  getStats,
};
