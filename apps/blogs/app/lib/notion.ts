/* eslint-disable @typescript-eslint/no-explicit-any */
import { Client } from '@notionhq/client';
import {
  //   PageObjectResponse,
  DatabaseObjectResponse,
  ImageBlockObjectResponse,
  PageObjectResponse,
  // PageObjectResponse,
} from '@notionhq/client/build/src/api-endpoints';
import { unstable_cache } from 'next/cache';
import { NotionToMarkdown } from 'notion-to-md';
// import { resolve } from 'path';
import { cache } from 'react';
import 'server-only';

// Initialize Notion client
export const notion = new Client({
  auth: process.env.NOTION_API_KEY,
});

// Environment variables validation
const databaseId = process.env.NOTION_DATABASE_ID;

if (!databaseId) {
  throw new Error('NOTION_DATABASE_ID is not set in environment variables');
}

// Cache configuration
const REVALIDATE_TIME = 3600; // 1 hour in seconds
const TAGS = {
  all: 'all-posts',
  single: (slug: string) => `post-${slug}`,
};

// Types for blog post
export interface NotionBlogPost {
  id: string;
  title: string;
  description: string;
  date: string;
  coverImage: string;
  tags: string[];
  slug: string;
  featured: boolean;
}

// Cached database fetch
export const getDatabase = unstable_cache(
  async () => {
    if (!databaseId) throw new Error('Database ID not found');

    const response = await notion.databases.retrieve({
      database_id: databaseId,
    });

    return response as DatabaseObjectResponse;
  },
  ['notion-database'],
  {
    revalidate: REVALIDATE_TIME,
    tags: [TAGS.all],
  },
);

// Cached posts fetch with published filter
export const getPosts = cache(async (): Promise<NotionBlogPost[]> => {
  try {
    const response = await notion.databases.query({
      database_id: databaseId,
      filter: {
        and: [
          {
            property: 'Status',
            status: {
              equals: 'Published',
            },
          },
        ],
      },
      sorts: [
        {
          property: 'Date',
          direction: 'descending',
        },
      ],
    });

    return response.results.map((page: any) => ({
      id: page.id,
      title: page.properties.Title.title[0]?.plain_text || '',
      description: page.properties.Description.rich_text[0]?.plain_text || '',
      date: page.properties.Date.created_time,
      coverImage: page.cover?.external?.url || page.cover?.file?.url || '',
      tags: page.properties.Tags.multi_select.map((tag: any) => tag.name),
      slug: page.properties.Slug.rich_text[0]?.plain_text || '',
      featured: page.properties.Featured.checkbox,
    }));
  } catch (error) {
    console.error('Error fetching posts:', error);
    return [];
  }
});

// Revalidate cache
export async function revalidateCache(postId?: string) {
  if (postId) {
    await fetch(`/api/revalidate?tag=${TAGS.single(postId)}`);
  } else {
    await fetch(`/api/revalidate?tag=${TAGS.all}`);
  }
}

// Get total number of published posts
export const getPublishedPostsCount = cache(async (): Promise<number> => {
  try {
    const response = await notion.databases.query({
      database_id: databaseId,
      filter: {
        property: 'Status',
        status: {
          equals: 'Published',
        },
      },
    });

    return response.results.length;
  } catch (error) {
    console.error('Error fetching posts count:', error);
    return 0;
  }
});

export const getPostBySlug = cache(
  async (slug: string): Promise<PageObjectResponse | undefined> => {
    try {
      const response = await notion.databases.query({
        database_id: databaseId,
        filter: {
          and: [
            {
              property: 'Slug',
              rich_text: {
                equals: slug,
              },
            },
            {
              property: 'Status',
              status: {
                equals: 'Published',
              },
            },
          ],
        },
      });

      const page = response.results[0];

      if (!page) {
        return undefined;
      }

      return page as PageObjectResponse;
    } catch (error) {
      console.error('Error fetching post by slug:', error);
      return undefined;
    }
  },
);

export async function getPageBlocks(pageId: string) {
  const blocks: any[] = [];
  let cursor = undefined;

  try {
    // Keep fetching blocks until there are no more
    while (true) {
      const { results, next_cursor } = await notion.blocks.children.list({
        block_id: pageId,
        page_size: 100, // Max number of blocks to fetch per request
        start_cursor: cursor,
      });

      blocks.push(...results);

      // If there's no next_cursor, we've reached the end
      if (!next_cursor) break;
      cursor = next_cursor;
    }

    return blocks;
  } catch (error) {
    console.error('Error fetching Notion blocks:', error);
    throw error;
  }
}

const n2m = new NotionToMarkdown({ notionClient: notion });

export async function getPostMarkdown(pageId: string) {
  const mdblocks = await n2m.pageToMarkdown(pageId);
  const markdown = n2m.toMarkdownString(mdblocks);
  return markdown;
}

export const getMediaProperties = (
  value: ImageBlockObjectResponse['image'],
): { source: string; caption: string } => {
  const source =
    value.type === 'external' ? value.external.url : value.file.url;
  const caption =
    value.caption && value.caption.length > 0
      ? value.caption[0].plain_text
      : '';

  return { source, caption };
};
