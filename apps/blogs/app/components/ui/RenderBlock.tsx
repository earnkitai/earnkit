/* eslint-disable @typescript-eslint/no-explicit-any */
import { BlockObjectResponse, RichTextItemResponse } from "@notionhq/client/build/src/api-endpoints"
import { getMediaProperties } from "../../lib/notion"
import { NotionHeading } from "./NotionHeading"
import { NotionImage } from "./NotionImage"
import { NotionText } from "./NotionText"
import CodeBlock from "./CodeBlock"

interface Props {
    block: BlockObjectResponse
}
// ImageBlockObjectResponse
/**
 * {
   caption: [],
   type: 'external',
   external: { url: 'https://youtu.be/DsL28RWOFJ8' }
 }
 */

export const RenderBlock: React.FC<React.PropsWithChildren<Props>> = ({ block }) => {
    // If empty block, return null
    if (!block) {
        return null
    }

    switch (block.type) {
    case "paragraph": {
        return (
            <p className="mb-6 leading-7 text-black/[80%] font-funnel-sans font-normal text-[1rem] md:text-[1.125rem]">
                <NotionText text={block.paragraph.rich_text} />
            </p>
        )
    }
    case "heading_1":
    case "heading_2":
    case "heading_3": {
        type HeadingType = typeof block.type;
        const value = (block as any)[block.type] as {
            rich_text: RichTextItemResponse[];
        };
        return <NotionHeading type={block.type as HeadingType} text={value.rich_text} />
    }

    case "callout": {
        const value = block.callout
        return (
            <div className="my-8 flex w-full rounded border border-transparent bg-color-2 p-4 text-color-9 bg-[#B8CCE033]">
                {value.icon?.type === "emoji" && <div className="text-yellow-500">{value.icon.emoji}</div>}

                <div className="text-foreground ml-4 font-funnel-sans font-medium text-[1rem] md:text-[1.125rem] border-l-2 border-black/[20%] pl-4">
                    <NotionText text={value.rich_text} />
                </div>
            </div>
        )
    }
    case "bulleted_list_item":
        return (
            <li className="mb-2 text-[1rem] md:text-[1.125rem]">
                <NotionText text={block.bulleted_list_item.rich_text} />
            </li>
        )
    case "numbered_list_item": {
        return (
            <li className="mb-2 text-[1rem] md:text-[1.125rem]">
                <NotionText text={block.numbered_list_item.rich_text} />
            </li>
        )
    }
    case "quote": {
        return (
            <blockquote className="mb-2 text-black italic font-funnel-sans font-medium text-[1rem] md:text-[1.125rem] border-l-2 border-black/[20%] pl-4 pl-8" >
                <NotionText text={block.quote.rich_text} />
            </blockquote>
        )
    }
    case "image": {
        const value = block.image
        const { source, caption } = getMediaProperties(value)
        return (
            <div className="my-8 flex flex-col space-y-4">
                <NotionImage src={source} alt={caption} />
                {caption && <p className="text-sm text-gray-600">{caption}</p>}
            </div>
        )
    }
    case "code": {
        return <div key={block.id} className="w-full overflow-x-auto">
            <CodeBlock
                language={block.code.language}
                text={block.code.rich_text || ""}
            />
        </div>
    }

    case "divider": {
        return <hr />
    }
    case "video": {
        const { source, caption } = getMediaProperties(block.video)
        // Convert YouTube URL to embed format
        const embedUrl = source.includes('youtube.com') || source.includes('youtu.be')
            ? source.replace(/(youtube\.com|youtu\.be)\/(watch\?v=)?/, 'youtube.com/embed/')
            : source

        return (
            <div className="my-8 flex flex-col space-y-2">
                <div className="relative w-full pt-[56.25%]">
                    <iframe
                        src={embedUrl}
                        className="absolute top-0 left-0 h-full w-full rounded-lg"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                    />
                </div>
                {caption && <p className="text-gray-500 text-sm">{caption}</p>}
            </div>
        )
    }
    default: {
        return <p>❌ Unsupported block {block.type === "unsupported" ? "unsupported by Notion API" : block.type})</p>
    }
    }
}
