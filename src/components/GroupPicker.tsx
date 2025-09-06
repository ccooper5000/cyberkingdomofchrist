import React from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

interface Group {
  id: string;
  name: string;
  isPrivate: boolean;
}

interface GroupPickerProps {
  groups: Group[];
  selectedGroupId?: string;
  onGroupSelect: (groupId: string | undefined) => void;
  className?: string;
}

export default function GroupPicker({ 
  groups, 
  selectedGroupId, 
  onGroupSelect, 
  className 
}: GroupPickerProps) {
  const [open, setOpen] = React.useState(false);

  const selectedGroup = groups.find(group => group.id === selectedGroupId);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("justify-between", className)}
        >
          {selectedGroup ? selectedGroup.name : "Select group..."}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[200px] p-0">
        <Command>
          <CommandInput placeholder="Search groups..." />
          <CommandList>
            <CommandEmpty>No group found.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                onSelect={() => {
                  onGroupSelect(undefined);
                  setOpen(false);
                }}
              >
                <Check
                  className={cn(
                    "mr-2 h-4 w-4",
                    !selectedGroupId ? "opacity-100" : "opacity-0"
                  )}
                />
                No group (Public)
              </CommandItem>
              {groups.map((group) => (
                <CommandItem
                  key={group.id}
                  onSelect={() => {
                    onGroupSelect(group.id);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      selectedGroupId === group.id ? "opacity-100" : "opacity-0"
                    )}
                  />
                  {group.name}
                  {group.isPrivate && (
                    <span className="ml-2 text-xs text-muted-foreground">(Private)</span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}