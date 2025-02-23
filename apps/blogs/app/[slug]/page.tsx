/* eslint-disable @typescript-eslint/no-explicit-any */
// app/blog/[slug]/page.tsx
import { notFound } from "next/navigation";
import { getPostBySlug, getPageBlocks } from "../lib/notion";
import { RenderBlock } from "../components/ui/RenderBlock";
import { formatDate } from "../lib/utils";
import Image from "next/image";
import Link from "next/link";

// Main blog post component
export default async function BlogPost({ params }: { params: { slug: string } }) {
    const post = await getPostBySlug(params.slug);
    console.log(post);

    if (!post) {
        notFound();
    }

    const blocks = await getPageBlocks(post.id);


    // Group list items together
    const groupedBlocks = blocks.reduce((acc: any[], block: any) => {
        const prevBlock = acc[acc.length - 1];

        if (
            (block.type === "bulleted_list_item" &&
                prevBlock?.type === "bulleted_list") ||
            (block.type === "numbered_list_item" &&
                prevBlock?.type === "numbered_list")
        ) {
            prevBlock.items.push(block);
            return acc;
        }

        if (block.type === "bulleted_list_item") {
            acc.push({
                type: "bulleted_list",
                items: [block],
            });
            return acc;
        }

        if (block.type === "numbered_list_item") {
            acc.push({
                type: "numbered_list",
                items: [block],
            });
            return acc;
        }

        acc.push(block);
        return acc;
    }, []);

    return (
        <main className="min-h-screen bg-white rounded-[56px] overflow-hidden pb-12 md:py-20" >
            <div className="flex md:hidden flex-row items-center w-full px-10">
                <div className="w-full text-[#2563E4] pt-12 pb-6 font-funnel-sans font-medium text-[1.125rem] rounded-full flex flex-row items-center justify-start gap-2">
                    <Link href="/">
                        <svg width="18" height="21" viewBox="0 0 18 21" fill="none" xmlns="http://www.w3.org/2000/svg" className="mr-2 min-w-[18px]">
                            <path d="M14.25 15.75V18.55M16.35 19.25H3.74999C2.69999 19.25 1.64999 18.55 1.64999 17.15M1.64999 17.15C1.64999 15.75 2.69999 15.05 3.74999 15.05H16.35V1.75H3.74999C2.69999 1.75 1.64999 2.8 1.64999 3.85V17.15Z" stroke="#2563E4" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                    </Link>
                    <svg width="10" height="17" viewBox="0 0 10 17" fill="none" xmlns="http://www.w3.org/2000/svg" className="mr-2 min-w-[10px]">
                        <path d="M1.83249 2.16499L8.16749 8.49999L1.83249 14.835" stroke="#2563E4" strokeWidth="2.5" strokeLinecap="round" />
                    </svg>
                    <span className="max-w-max text-ellipsis overflow-hidden whitespace-nowrap text-[1.125rem]">{post.properties["Title"]?.type === "title" && post.properties["Title"].title[0]?.plain_text}</span>
                </div>
            </div>
            <article className="container max-w-3xl mx-auto px-0 md:px-4 py-4 md:py-8 flex flex-col items-center justify-center ">
                <Image
                    src={post.cover?.type === "external" ? post.cover.external.url : post.cover?.file?.url || ""}
                    alt={"earnkit blog image"}
                    width={750}
                    height={405}
                    quality={85}
                    className="object-cover aspect-[16/10] rounded-none md:rounded-2xl"
                />
                <div className="p-10 pb-4 md:p-12 flex flex-col gap-6 items-center justify-center w-full md:w-[90%]">
                    <h1 className="text-3xl md:text-4xl font-bold font-funnel-display text-black">
                        {post.properties["Title"]?.type === "title" && post.properties["Title"].title[0]?.plain_text}
                    </h1>

                    <p className="text-black/[40%] text-[1rem] font-funnel-sans font-normal leading-[17px] py-1">
                        {post.properties["Description"]?.type === "rich_text" && post.properties["Description"].rich_text[0]?.plain_text}
                    </p>

                    <div className="flex items-center justify-start gap-4 text-sm text-gray-600 w-full">
                        <span className='font-funnel-sans font-normal text-[0.85rem] text-black/[40%]'>{formatDate(post.created_time)}</span>
                        <div className="flex gap-3">
                            {post.properties["Tags"]?.type === "multi_select" && post.properties["Tags"].multi_select.map((tag: any, key: number) => (
                                <span
                                    key={key}
                                    className="font-funnel-sans font-normal text-[0.825rem] px-[12px] py-[2px] bg-transparent border border-black/[40%] rounded-full text-black/[40%]"
                                >
                                    {tag.name}
                                </span>
                            ))}
                        </div>
                    </div>



                    <div className="prose w-full py-4">
                        {groupedBlocks.map((block: any) => {
                            if (block.type === "bulleted_list") {
                                return (
                                    <ul key={block.items[0].id} className="mb-4">
                                        {block.items.map((item: any) => (
                                            // <Block key={item.id} block={item} />
                                            <RenderBlock key={item.id} block={item} />
                                        ))}
                                    </ul>
                                );
                            }

                            if (block.type === "numbered_list") {
                                return (
                                    <ol key={block.items[0].id} className="mb-4">
                                        {block.items.map((item: any) => (
                                            <RenderBlock key={item.id} block={item} />
                                        ))}
                                    </ol>
                                );
                            }

                            return <RenderBlock key={block.id} block={block} />;
                        })}
                    </div>
                </div>
            </article>

            <div className="flex flex-row items-center justify-center w-full">
                <Link href="/" className="bg-[#2563E4] text-white py-6 px-16 font-funnel-sans font-medium text-[1.325rem] rounded-full flex flex-row items-center gap-2 blog-home-link">
                    <svg width="20" height="23" viewBox="0 0 20 23" fill="none" xmlns="http://www.w3.org/2000/svg" className="mr-6">
                        <path d="M15.9999 17.5313V20.7313M18.3999 21.5313H3.99985C2.79985 21.5313 1.59985 20.7313 1.59985 19.1313M1.59985 19.1313C1.59985 17.5313 2.79985 16.7313 3.99985 16.7313H18.3999V1.53125H3.99985C2.79985 1.53125 1.59985 2.73125 1.59985 3.93125V19.1313Z" stroke="white" strokeWidth="2.28571" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    Blog Home
                </Link>
            </div>
        </main>
    );
}