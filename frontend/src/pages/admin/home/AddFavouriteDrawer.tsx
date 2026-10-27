import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Form, Input, Select } from 'antd';
import * as adminHomeApi from '../../../api/adminHome';
import { apiErrorMessage } from '../../../lib/apiError';
import { space } from '../../../theme/tokens';
import { SideDrawer } from '../../../ui/SideDrawer';
import { toast } from '../../../ui/Toast';
import { FAVOURITE_ICONS } from './favouriteIcons';

// "Add Shortcut" (Admin Home → My Favourites). Its own chunk: loaded the first time the drawer opens, so the form code stays out of the home page's budget.
export function AddFavouriteDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form] = Form.useForm<{ label: string; path: string; icon: string }>();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: adminHomeApi.createFavourite,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'favourites'] });
      form.resetFields();
      toast.success('Shortcut added');
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err, 'Could not add this shortcut.')),
  });

  return (
    <SideDrawer
      open={open}
      onClose={onClose}
      title="Add Shortcut"
      formId="add-favourite-form"
      primaryLabel="Add"
      primaryLoading={mutation.isPending}
    >
      <Form
        id="add-favourite-form"
        form={form}
        layout="vertical"
        requiredMark
        onFinish={(values) => mutation.mutate(values)}
      >
        <Form.Item name="label" label="Label" rules={[{ required: true, max: 60 }]}>
          <Input placeholder="Add Employee" />
        </Form.Item>
        <Form.Item name="path" label="Link" rules={[{ required: true, max: 200 }]}>
          <Input placeholder="/admin/employee/add" />
        </Form.Item>
        <Form.Item name="icon" label="Icon" rules={[{ required: true }]}>
          <Select
            options={Object.keys(FAVOURITE_ICONS).map((key) => {
              const Icon = FAVOURITE_ICONS[key]!;
              return {
                value: key,
                label: (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: space[2] }}>
                    <Icon /> {key}
                  </span>
                ),
              };
            })}
          />
        </Form.Item>
      </Form>
    </SideDrawer>
  );
}
