import type { ComponentType } from 'react';
import {
  AuditOutlined,
  BankOutlined,
  CalendarOutlined,
  DollarOutlined,
  FileTextOutlined,
  HomeOutlined,
  SettingOutlined,
  TeamOutlined,
  TrophyOutlined,
  UserAddOutlined,
} from '@ant-design/icons';

// Fixed icon set for My Favourites shortcut tiles — UserFavourite.icon
// stores one of these keys, never a free-form icon name.
export const FAVOURITE_ICONS: Record<string, ComponentType> = {
  useradd: UserAddOutlined,
  team: TeamOutlined,
  calendar: CalendarOutlined,
  file: FileTextOutlined,
  dollar: DollarOutlined,
  setting: SettingOutlined,
  audit: AuditOutlined,
  home: HomeOutlined,
  trophy: TrophyOutlined,
  bank: BankOutlined,
};
