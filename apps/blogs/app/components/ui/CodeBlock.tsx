/* eslint-disable @typescript-eslint/no-explicit-any */
"use client"
import React, { useEffect } from 'react';
import Prism from 'prismjs';
import 'prismjs/themes/prism.css';
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-python";
import "prismjs/components/prism-java";
import "prismjs/components/prism-c";
import "prismjs/components/prism-cpp";
// Add more language imports as needed

interface CodeBlockProps {
    language?: string;
    text: any[];
}

export default function CodeBlock({ language = 'javascript', text }: CodeBlockProps) {
    // Extract plain text from Notion's rich text format
    const code = text.map(t => t.plain_text).join('');

    useEffect(() => {
        // Highlight code when component mounts or updates
        Prism.highlightAll();
    }, [code]);

    return (
        <div className="relative group bg-black/[4%] pt-6 p-4 text-[0.875rem] md:text-[1rem]">
            {/* Language indicator */}
            <div className="absolute right-2 top-2 text-sm text-gray-400">
                {language}
            </div>

            {/* Code block */}
            <pre className="!mt-0 rounded-lg w-full overflow-x-auto">
                <code className={`language-${language}`}>
                    {code}
                </code>
            </pre>

            {/* Copy button */}
            <button
                onClick={() => navigator.clipboard.writeText(code)}
                className="absolute right-2 bottom-2 bg-gray-700 text-white px-2 py-1 rounded text-sm opacity-0 group-hover:opacity-100 transition-opacity"
            >
                Copy
            </button>
        </div>
    );
}