import type { APIRoute } from 'astro';
import data from '../data/changelog.json';

// Public JSON of the same changelog the site renders, for the Snap311 app's
// in-app "What's New". Emits src/data/changelog.json verbatim — no new parser.
export const prerender = true;
export const GET: APIRoute = () =>
  new Response(JSON.stringify(data), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300',
    },
  });
