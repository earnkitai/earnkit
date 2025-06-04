/* eslint-disable @typescript-eslint/no-explicit-any */
import { Metadata } from 'next';
import Link from 'next/link';
import Image from 'next/image';
import { getPosts } from '@/app/lib/notion';
import { formatDate } from '@/app/lib/utils';

export const metadata: Metadata = {
  title: 'Blog | EarnKit',
  description: 'Latest updates, guides and insights about EarnKit and AI agents.',
};

// Types for our blog data
interface BlogPost {
  id: string;
  title: string;
  description: string;
  date: string;
  coverImage: string;
  tags: string[];
  slug: string;
  featured: boolean;
}

export default async function Blog({ params }: any) {
  const notionPosts: BlogPost[] = await getPosts();
  console.log(notionPosts, 'posts');

  const POSTS_PER_PAGE = 9;
  const currentPage = Number(params?.page) || 1;
  const totalPages = Math.ceil((notionPosts.length - 1) / POSTS_PER_PAGE);

  const featuredPost = notionPosts.find(post => post.featured) || notionPosts[0];
  const otherPosts = notionPosts.filter(post => post.id !== featuredPost.id);
  const startIndex = (currentPage - 1) * POSTS_PER_PAGE;
  const endIndex = startIndex + POSTS_PER_PAGE;
  const currentPosts = otherPosts.slice(startIndex, endIndex);

  return (
    <main className="min-h-screen bg-[#F8F9FB] rounded-[56px] overflow-hidden">
      <div className='bg-white px-10 md:px-0'>
        <div className="flex md:hidden flex-row items-center w-full">
          <Link href="/" className="text-[#2563E4] pt-12 pb-6 font-funnel-sans font-medium text-[1.125rem] rounded-full flex flex-row items-center justify-start gap-2">
            <svg width="18" height="21" viewBox="0 0 18 21" fill="none" xmlns="http://www.w3.org/2000/svg" className="mr-2 min-w-[18px]">
              <path d="M14.25 15.75V18.55M16.35 19.25H3.74999C2.69999 19.25 1.64999 18.55 1.64999 17.15M1.64999 17.15C1.64999 15.75 2.69999 15.05 3.74999 15.05H16.35V1.75H3.74999C2.69999 1.75 1.64999 2.8 1.64999 3.85V17.15Z" stroke="#2563E4" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Blog Home
          </Link>
        </div>
        <div className="container mx-auto max-w-6xl 2xl:max-w-7xl bg-white py-10 md:py-20">

          {/* Featured Post */}
          <div>
            <Link href={`/${featuredPost.slug}`} className="group">
              <div className="flex flex-col md:flex-row gap-16 items-center">
                <div className="relative aspect-[16/9] rounded-2xl overflow-hidden bg-blue-100 flex-1 w-full md:min-w-[55%]">
                  <Image
                    src={featuredPost.coverImage}
                    alt={featuredPost.title}
                    fill
                    className="object-cover"
                    placeholder="blur"
                    blurDataURL="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAwIiBoZWlnaHQ9IjYwIiBmaWxsPSIjYjhjY2UwIi8+"
                  />
                </div>
                <div>
                  <div className='w-full md:w-[80%] flex flex-col gap-[20px]'>
                    <p className="text-black/[40%] md:text-[1rem] text-[0.825rem] font-funnel-sans font-normal leading-[17px]">{formatDate(featuredPost.date)}</p>
                    <h1 className="md:text-4xl text-3xl font-semibold text-black font-funnel-display transition-colors line-clamp-3">
                      {featuredPost.title}
                    </h1>
                    <p className="text-black font-funnel-sans font-normal text-[1.125rem] leading-[24px] line-clamp-3">{featuredPost.description}</p>
                    <div className="flex gap-3">
                      {featuredPost.tags.map((tag) => (
                        <span
                          key={tag}
                          className="font-funnel-sans font-normal text-[0.825rem] px-[12px] py-[2px] bg-transparent border border-black/[40%] rounded-full text-black/[40%]"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </Link>
          </div>
        </div>
      </div>
      <div className='bg-black/[4%] pb-20'>
        <div className="container px-10 md:px-0 mx-auto max-w-6xl 2xl:max-w-7xl pt-20">
          {/* Blog Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-14 ">
            {currentPosts.map((post) => (
              <Link key={post.id} href={`/${post.slug}`} className="group border border-transparent hover:scale-[1.02] rounded-2xl transition-all" >
                <div className="relative aspect-[16/9] rounded-2xl overflow-hidden bg-blue-100 mb-4">
                  <Image
                    src={post.coverImage}
                    alt={post.title}
                    fill
                    className="object-cover"
                    placeholder="blur"
                    blurDataURL="data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAwIiBoZWlnaHQ9IjYwIiBmaWxsPSIjYjhjY2UwIi8+"
                  />
                </div>
                <div className='flex flex-col pt-3 px-4 gap-4'>
                  <h2 className="text-xl font-funnel-sans font-semibold mb-2 text-black transition-colors line-clamp-3">
                    {post.title}
                  </h2>
                  <div className="flex items-center gap-4 text-sm text-gray-600 mb-3">
                    {post.tags.length > 0 && <div className="flex gap-3">
                      {post.tags.map((tag) => (
                        <span
                          key={tag}
                          className="font-funnel-sans font-normal text-[0.825rem] px-[12px] py-[2px] bg-transparent border border-black/[40%] rounded-full text-black/[40%]"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>}
                    <span className='font-funnel-sans font-normal text-[0.85rem] text-black/[40%]'>{formatDate(post.date)}</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex justify-center mt-12 gap-2">
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
                <Link
                  key={page}
                  href={`/blog?page=${page}`}
                  className={`px-4 py-2 rounded-lg ${currentPage === page
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                >
                  {page}
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
