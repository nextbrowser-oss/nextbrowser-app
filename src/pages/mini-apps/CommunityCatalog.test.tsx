// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AccountReviews } from './AccountReviews';
import { PublishMiniApp } from './PublishMiniApp';
import { invoke } from '../../electronBridge';
import { TooltipProvider } from '../../shared/ui';

vi.mock('../../electronBridge', () => ({ invoke: vi.fn() }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it('edits one existing review from the signed-in account', async () => {
  const mine = {id:'r',author:'Ada',rating:3,comment:'First',updated_at:''};
  vi.mocked(invoke).mockResolvedValueOnce({total:1,average:3,reviews:[mine],mine})
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce({total:1,average:5,reviews:[{...mine,rating:5,comment:'Updated'}],mine:{...mine,rating:5,comment:'Updated'}});
  render(<AccountReviews owner="account/test" id="work-board" />);
  fireEvent.click(await screen.findByRole('button',{name:'Edit your review'}));
  fireEvent.click(screen.getByRole('radio',{name:'5 stars'}));
  fireEvent.change(screen.getByLabelText('Comment (optional)'),{target:{value:'Updated'}});
  fireEvent.click(screen.getByRole('button',{name:'Save review'}));
  await screen.findByText('Updated');
  expect(invoke).toHaveBeenCalledWith('mini_apps_review_save',{owner:'account/test',id:'work-board',rating:5,comment:'Updated'});
  expect(screen.getByText('★ 5.0 / 5 · 1 rating')).toBeTruthy();
});

it('publishes the chosen package and both captioned screenshots', async () => {
  const onPublished = vi.fn();
  const raw = '{"id":"work-board"}';
  vi.mocked(invoke).mockResolvedValueOnce({id:'work-board',name:'Work board',version:'1.0.0'}).mockResolvedValueOnce(null);
  render(<TooltipProvider><PublishMiniApp owner="account/test" onClose={() => {}} onPublished={onPublished} /></TooltipProvider>);
  const pkg = new File([raw],'board.nbmini.json',{type:'application/json'});
  Object.defineProperty(pkg,'text',{value:async () => raw});
  fireEvent.change(screen.getByLabelText('Mini app package'),{target:{files:[pkg]}});
  await screen.findByText(/Work board · work-board/);
  fireEvent.change(screen.getByLabelText(/^Screenshots/),{target:{files:['start','finish'].map(name=>new File([name],name+'.png',{type:'image/png'}))}});
  for (const [label,value] of [['Caption for start.png','Opening view'],['Caption for finish.png','Final view'],['Use cases (one per line)','Build a board'],['Requirements','Nextbrowser'],['Example agent request','Open the board']]) {
    fireEvent.change(screen.getByLabelText(label),{target:{value}});
  }
  fireEvent.click(screen.getByRole('button',{name:'Publish to catalog'}));
  await waitFor(()=>expect(onPublished).toHaveBeenCalledWith('Work board'));
  expect(invoke).toHaveBeenCalledWith('mini_apps_publish',{owner:'account/test',id:'work-board',publication:{package:raw,useCases:['Build a board'],requirements:'Nextbrowser',example:'Open the board',screenshots:[{alt:'Opening view',data:'c3RhcnQ='},{alt:'Final view',data:'ZmluaXNo'}]}});
});
