import { Routes } from '@angular/router';
import { LobbyPageComponent } from './features/lobby/lobby-page.component';
import { TablePageComponent } from './features/table/table-page.component';

export const routes: Routes = [
	{
		path: '',
		component: LobbyPageComponent,
	},
	{
		path: 'table/:tableId',
		component: TablePageComponent,
	},
	{
		path: '**',
		redirectTo: '',
	},
];
