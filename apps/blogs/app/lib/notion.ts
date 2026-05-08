/* eslint-disable @typescript-eslint/no-explicit-any */
import { Client } from '@notionhq/client';
import {
  DatabaseObjectResponse,
  ImageBlockObjectResponse,
  PageObjectResponse,
} from '@notionhq/client/build/src/api-endpoints';
import { unstable_cache } from 'next/cache';
import { NotionToMarkdown } from 'notion-to-md';
import { cache } from 'react';

// Initialize Notion client
export const notion = new Client({
  auth: process.env.NOTION_API_KEY,
});

const databaseId = process.env.NOTION_DATABASE_ID;

function getDbId(): string {
  return databaseId ?? '';
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
    const response = await notion.databases.retrieve({
      database_id: getDbId(),
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
      database_id: getDbId(),
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
      database_id: getDbId(),
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
        database_id: getDbId(),
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

/**
 * Fetch all children of a block (handles pagination).
 */
async function fetchAllChildren(blockId: string): Promise<any[]> {
  const blocks: any[] = [];
  let cursor: string | undefined = undefined;

  while (true) {
    const { results, next_cursor } = await notion.blocks.children.list({
      block_id: blockId,
      page_size: 100,
      start_cursor: cursor,
    });

    blocks.push(...results);

    if (!next_cursor) break;
    cursor = next_cursor;
  }

  return blocks;
}

/**
 * Recursively fetch blocks and their children.
 * Any block with has_children = true will have a `children` array attached.
 */
async function fetchBlocksRecursively(blockId: string): Promise<any[]> {
  const blocks = await fetchAllChildren(blockId);

  const blocksWithChildren = await Promise.all(
    blocks.map(async (block) => {
      if (block.has_children) {
        const children = await fetchBlocksRecursively(block.id);
        return { ...block, children };
      }
      return block;
    }),
  );

  return blocksWithChildren;
}

export async function getPageBlocks(pageId: string): Promise<any[]> {
  try {
    return await fetchBlocksRecursively(pageId);
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

/**
 * Get media properties for an image block.
 *
 * Notion-hosted images (type === 'file') have URLs that expire after ~1 hour.
 * To avoid serving expired URLs, we re-fetch the block from the API so Notion
 * returns a freshly-signed URL at render time. External images are stable and
 * returned as-is.
 */
export async function getMediaProperties(
  value: ImageBlockObjectResponse['image'],
  blockId?: string,
): Promise<{ source: string; caption: string }> {
  let source: string;

  if (value.type === 'external') {
    source = value.external.url;
  } else {
    // Notion file URLs expire. Re-fetch the block to get a fresh signed URL.
    if (blockId) {
      try {
        const freshBlock = (await notion.blocks.retrieve({
          block_id: blockId,
        })) as ImageBlockObjectResponse;
        source =
          freshBlock.image.type === 'file'
            ? freshBlock.image.file.url
            : (freshBlock.image as any).external?.url ?? value.file.url;
      } catch {
        // Fall back to the original (possibly expired) URL
        source = value.file.url;
      }
    } else {
      source = value.file.url;
    }
  }

  const caption =
    value.caption && value.caption.length > 0
      ? value.caption[0].plain_text
      : '';

  return { source, caption };
}