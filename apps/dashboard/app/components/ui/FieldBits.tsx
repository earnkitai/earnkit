'use client';

import React from 'react';
import { IoInformationCircleOutline, IoChevronDown } from 'react-icons/io5';

/* -----------------------------------------------------
 * InfoTooltip - Question mark icon with tooltip
 * --------------------------------------------------- */

interface InfoTooltipProps {
  text: string;
}

export function InfoTooltip({ text }: InfoTooltipProps) {
  return (
    <div className="relative group">
      <IoInformationCircleOutline className="w-4 h-4 text-gray-400 cursor-help" />
      <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 whitespace-nowrap z-50">
        {text}
        <div className="absolute left-1/2 -translate-x-1/2 top-full w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900" />
      </div>
    </div>
  );
}

/* -----------------------------------------------------
 * FieldLabel - Label with optional required indicator
 * --------------------------------------------------- */

interface FieldLabelProps {
  label: string;
  required?: boolean;
  optional?: boolean;
}

interface FieldLabelProps {
  label: string;
  required?: boolean;
  optional?: boolean;
}

export function FieldLabel({ label, required, optional }: FieldLabelProps) {
  return (
    <label className="text-xs font-bold text-foreground uppercase block mb-1.5">
      {label}{' '}
      {required ? (
        <span className="text-red-500">*</span>
      ) : optional ? (
        <span className="opacity-50 normal-case font-normal">(optional)</span>
      ) : null}
    </label>
  );
}

/* -----------------------------------------------------
 * SectionHeader - Collapsible section header
 * --------------------------------------------------- */

interface SectionHeaderProps {
  title: string;
  tooltip?: string;
  isOpen: boolean;
  onToggle: () => void;
}

export function SectionHeader({
  title,
  tooltip,
  isOpen,
  onToggle,
}: SectionHeaderProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="w-full flex items-center justify-between py-3 border-t border-gray-100"
    >
      <div className="flex items-center gap-2">
        <span className="font-semibold font-title text-gray-900">{title}</span>
        {tooltip && <InfoTooltip text={tooltip} />}
      </div>
      <IoChevronDown
        className={`w-5 h-5 text-gray-400 transition-transform duration-200 ${
          isOpen ? 'rotate-180' : ''
        }`}
      />
    </button>
  );
}

/* -----------------------------------------------------
 * OptionCard - Selectable card button
 * --------------------------------------------------- */

interface OptionCardProps {
  label: React.ReactNode;
  selected: boolean;
  onClick: () => void;
  className?: string;
}

export function OptionCard({
  label,
  selected,
  onClick,
  className = '',
}: OptionCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`
        flex items-center justify-center gap-2 px-4 py-3 
        rounded-xl border transition-all duration-200
        ${
          selected
            ? 'border-emerald-500 bg-emerald-50 text-emerald-700 font-semibold'
            : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300'
        }
        ${className}
      `}
    >
      {label}
    </button>
  );
}
