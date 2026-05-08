/* eslint-disable @typescript-eslint/no-explicit-any */
import { BlockObjectResponse } from '@notionhq/client/build/src/api-endpoints';
import { getMediaProperties } from '../../lib/notion';
import { NotionHeading } from './NotionHeading';
import { NotionText } from './NotionText';
import CodeBlock from './CodeBlock';

interface Props {
  block: BlockObjectResponse | any;
}

// Internal Image component for the block renderer
async function NotionBlockImage({ block }: { block: any }) {
  const { source, caption } = await getMediaProperties(block.image, block.id);

  if (!source) return null;

  return (
    <div className="my-8 flex flex-col items-center w-full">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={source}
        alt={caption || 'Notion Image'}
        className="rounded-lg max-w-full h-auto object-cover"
      />
      {caption && (
        <p className="mt-2 text-sm text-gray-500 italic">{caption}</p>
      )}
    </div>
  );
}

export const RenderBlock: React.FC<React.PropsWithChildren<Props>> = ({
  block,
}) => {
  if (!block) return null;

  switch (block.type) {
    case 'paragraph': {
      const richText = block.paragraph?.rich_text ?? [];
      if (richText.length === 0) return <div className="mb-4" />;
      return (
        <p className="mb-6 leading-7 text-black/[80%] font-funnel-sans font-normal text-[1rem] md:text-[1.125rem]">
          <NotionText text={richText} />
        </p>
      );
    }

    case 'heading_1':
    case 'heading_2':
    case 'heading_3':
      return (
        <NotionHeading
          type={block.type}
          text={(block as any)[block.type].rich_text}
        />
      );

    case 'bulleted_list_item':
    case 'numbered_list_item': {
      const blockData = (block as any)[block.type];
      const richText = blockData?.rich_text ?? [];

      return (
        <li className="mb-2 list-outside text-[1rem] md:text-[1.125rem] font-funnel-sans font-normal text-black/[80%]">
          {richText.length > 0 && <NotionText text={richText} />}
          {block.children && block.children.length > 0 && (
            <div className="ml-6 mt-1 mb-2">
              {block.children.map((child: any) => (
                <RenderBlock key={child.id} block={child} />
              ))}
            </div>
          )}
        </li>
      );
    }

    case 'callout': {
      const value = block.callout;
      return (
        <div className="my-8 flex w-full rounded border border-transparent bg-[#B8CCE033] p-4">
          {value.icon?.type === 'emoji' && (
            <div className="mr-4 text-xl">{value.icon.emoji}</div>
          )}
          <div className="text-foreground border-l-2 border-black/[10%] pl-6">
            <NotionText text={value.rich_text} />
            {block.children && block.children.length > 0 && (
              <div className="mt-4">
                {block.children.map((child: any) => (
                  <RenderBlock key={child.id} block={child} />
                ))}
              </div>
            )}
          </div>
        </div>
      );
    }

    case 'image':
      return <NotionBlockImage block={block} />;

    case 'code':
      return (
        <div key={block.id} className="w-full overflow-x-auto my-6">
          <CodeBlock
            language={block.code.language}
            text={block.code.rich_text}
          />
        </div>
      );

    case 'divider':
      return <hr className="my-8 border-gray-100" />;

    case 'quote':
      return (
        <blockquote className="border-l-4 border-black pl-4 italic my-6 text-lg">
          <NotionText text={block.quote.rich_text} />
        </blockquote>
      );

    default:
      return null;
  }
};
