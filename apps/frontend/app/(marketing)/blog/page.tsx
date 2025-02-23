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

interface BlogPageProps {
    searchParams: { page?: string }
}

export default async function Blog({ searchParams }: BlogPageProps) {
    const params = await searchParams;
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
            <div className='bg-white'>
                <div className="container mx-auto max-w-6xl 2xl:max-w-7xl bg-white py-20">
                    {/* Featured Post */}
                    <div>
                        <Link href={`https://blog.earnkit.com/${featuredPost.slug}`} target='_blank' className="group">
                            <div className="flex flex-col md:flex-row gap-16 items-center">
                                <div className="relative aspect-[16/10] rounded-2xl overflow-hidden bg-blue-100 flex-1 min-w-[55%]">
                                    <Image
                                        src={featuredPost.coverImage}
                                        alt={featuredPost.title}
                                        fill
                                        className="object-cover"
                                    />
                                </div>
                                <div>
                                    <div className='w-[80%] flex flex-col gap-[20px]'>
                                        <p className="text-black/[40%] text-[1rem] font-funnel-sans font-normal leading-[17px]">{featuredPost.date}</p>
                                        <h1 className="text-4xl font-semibold text-black font-funnel-display transition-colors line-clamp-3">
                                            {featuredPost.title}
                                        </h1>
                                        <p className="text-black font-funnel-sans font-normal text-[1.125rem] leading-[24px]">{featuredPost.description}</p>
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
                <div className="container mx-auto max-w-6xl 2xl:max-w-7xl pt-20">
                    {/* Blog Grid */}
                    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-14 ">
                        {currentPosts.map((post) => (
                            <Link key={post.id} href={`https://blog.earnkit.com/${post.slug}`} target='_blank' className="group border border-transparent hover:scale-[1.02] hover:border-black/[40%] rounded-2xl transition-all" >
                                <div className="relative aspect-[16/10] rounded-2xl overflow-hidden bg-blue-100 mb-4">
                                    <Image
                                        src={post.coverImage}
                                        alt={post.title}
                                        fill
                                        className="object-cover"
                                    />
                                </div>
                                <div className='flex flex-col pt-3 px-4 gap-4'>
                                    <h2 className="text-xl font-funnel-sans font-semibold mb-2 text-black transition-colors line-clamp-3">
                                        {post.title}
                                    </h2>
                                    <div className="flex items-center gap-4 text-sm text-gray-600 mb-3">
                                        <div className="flex gap-3">
                                            {post.tags.map((tag) => (
                                                <span
                                                    key={tag}
                                                    className="font-funnel-sans font-normal text-[0.825rem] px-[12px] py-[2px] bg-transparent border border-black/[40%] rounded-full text-black/[40%]"
                                                >
                                                    {tag}
                                                </span>
                                            ))}
                                        </div>
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
